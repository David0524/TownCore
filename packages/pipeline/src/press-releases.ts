import { createHash } from 'node:crypto';
import { htmlToText } from '@towncore/adapters';
import type { SourceKind } from '@towncore/config';
import {
  and,
  eq,
  inArray,
  logAdminAction,
  mailDomains,
  messages,
  records,
  sources,
  threads,
  type Db,
} from '@towncore/db';

// Press releases from the newsroom inbox (ported from Kyle's TownCore inbound releases). An agency
// or organization emails a release to a town address (news@…); staff open it in the shared inbox
// and press "Send to newsroom", which stores it as a primary-source record of the town, on a
// source made on first use per town and kind (platform `inbox`). The story finder then handles it
// like any other record: classification, the wrong-town check, tiers, the writer and fact-check.
//
// Rule 3: only a release from the agency or organization itself is a primary source, never
// another news outlet's story, so staff confirm that on every send and no `other_outlet` kind is
// offered. Each send is audited; a message is stored once per town however often it's sent.

/** Kinds a release can be filed under: the town government's own, police, fire or schools. */
export const NEWSROOM_KINDS = ['city_news', 'police', 'fire', 'schools'] as const;
export type NewsroomKind = (typeof NEWSROOM_KINDS)[number] & SourceKind;

export const newsroomKindLabels: Record<NewsroomKind, string> = {
  city_news: 'The town government',
  police: 'Police',
  fire: 'Fire rescue',
  schools: 'Schools',
};

/** Longest release text stored; a release is a page or two. */
export const MAX_RELEASE_CHARS = 50_000;
/** Shorter than this, there's nothing to write a story from. */
export const MIN_RELEASE_CHARS = 80;

export class NewsroomError extends Error {}

/** "Fwd: Road closure" → "Road closure". */
export function releaseTitle(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').trim() || subject.trim();
}

/**
 * The message as plain text for the writer: the text part when there is one, else the
 * (already sanitized) HTML as text; quoted replies, control characters and runs of blank lines
 * dropped.
 */
export function releaseText(m: { textBody: string | null; htmlBodySanitized: string | null }) {
  const raw = m.textBody?.trim()
    ? m.textBody
    : m.htmlBodySanitized
      ? htmlToText(m.htmlBodySanitized)
      : '';
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .split('\n')
      .filter((line) => !/^\s*>/.test(line))
      .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_RELEASE_CHARS)
  );
}

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

/**
 * The kind to preselect: the kind of the town's source whose website the sender's address
 * matches most closely (a release from the police site's domain is `police`, one from the city's
 * own domain `city_news`). Null when the sender isn't one of the town's sources. Staff confirm.
 */
export function suggestKind(
  fromAddress: string,
  townSources: { kind: string; url: string | null }[],
): NewsroomKind | null {
  const domain = fromAddress
    .split('@')[1]
    ?.toLowerCase()
    .replace(/^www\./, '');
  if (!domain) return null;
  // How closely a source's website matches the sender: the same host, the sender on a subdomain
  // of it, or it on a subdomain of the sender's (a city address and the police subdomain).
  const closeness = (url: string | null) => {
    const h = host(url);
    if (!h) return 0;
    if (h === domain) return 3;
    if (domain.endsWith(`.${h}`)) return 2;
    return h.endsWith(`.${domain}`) ? 1 : 0;
  };
  const asKind = (kind: string): NewsroomKind | null =>
    (NEWSROOM_KINDS as readonly string[]).includes(kind)
      ? (kind as NewsroomKind)
      : ['agenda', 'events', 'meeting_video', 'reference'].includes(kind)
        ? 'city_news'
        : null;
  let best: { kind: NewsroomKind; score: number } | null = null;
  for (const s of townSources) {
    const kind = asKind(s.kind);
    const score = closeness(s.url);
    // Ties go to the more specific agency (police, fire, schools) over the government.
    if (
      kind &&
      score > 0 &&
      (!best || score > best.score || (score === best.score && best.kind === 'city_news'))
    )
      best = { kind, score };
  }
  return best?.kind ?? null;
}

/** The external id a message is stored under: its Message-ID, else our row id. */
const externalIdFor = (m: { id: string; rfcMessageId: string | null }) =>
  `message:${m.rfcMessageId?.trim() || m.id}`;

/** The town's inbox source for this kind, made on first use. */
async function inboxSource(db: Db, townId: string, kind: NewsroomKind): Promise<string> {
  const key = `inbox:${kind}`;
  const find = async () =>
    (
      await db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.townId, townId), eq(sources.key, key)))
    )[0]?.id;
  const found = await find();
  if (found) return found;
  const [made] = await db
    .insert(sources)
    .values({ townId, key, kind, platform: 'inbox', adapter: 'inbox', config: {} })
    .onConflictDoNothing()
    .returning({ id: sources.id });
  return made?.id ?? (await find())!;
}

/** Records already made from these inbox messages (by our message row id), for the inbox. */
export async function newsroomRecords(
  db: Db,
  messageRows: { id: string; rfcMessageId: string | null }[],
): Promise<Map<string, { recordId: string; kind: string }>> {
  if (!messageRows.length) return new Map();
  const ids = messageRows.map(externalIdFor);
  const rows = await db
    .select({ id: records.id, externalId: records.externalId, kind: sources.kind })
    .from(records)
    .innerJoin(sources, eq(sources.id, records.sourceId))
    .where(and(eq(sources.platform, 'inbox'), inArray(records.externalId, ids)));
  const out = new Map<string, { recordId: string; kind: string }>();
  for (const m of messageRows) {
    const hit = rows.find((r) => r.externalId === externalIdFor(m));
    if (hit) out.set(m.id, { recordId: hit.id, kind: hit.kind });
  }
  return out;
}

/**
 * Stores an inbox message as a press-release record of its town. Refused unless staff confirmed
 * it comes from the organization itself (Rule 3), the message came in from outside, isn't
 * quarantined, was sent to a town's address and has text. Sending a message already stored for
 * the town returns that record.
 */
export async function sendToNewsroom(
  db: Db,
  input: {
    messageId: string;
    staffId: string;
    kind: string;
    fromOrganization: boolean;
    now?: Date;
  },
): Promise<{ recordId: string; created: boolean; townId: string }> {
  const kind = NEWSROOM_KINDS.find((k) => k === input.kind);
  if (!kind) throw new NewsroomError('Choose who sent the release.');
  if (!input.fromOrganization)
    throw new NewsroomError(
      'Only a release from the agency or organization itself can go to the newsroom, never another news outlet’s story (Rule 3). Confirm it to send.',
    );
  const [row] = await db
    .select({ message: messages, townId: mailDomains.townId, threadId: threads.id })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .innerJoin(mailDomains, eq(mailDomains.id, threads.domainId))
    .where(eq(messages.id, input.messageId));
  if (!row) throw new NewsroomError('That message no longer exists.');
  const m = row.message;
  if (m.direction !== 'inbound') throw new NewsroomError('Only a message we received can be sent.');
  if (m.quarantined) throw new NewsroomError('A quarantined message can’t go to the newsroom.');
  if (!row.townId)
    throw new NewsroomError('This address isn’t a town’s, so there is no newsroom to send it to.');
  const townId = row.townId;
  const externalId = externalIdFor(m);

  const [existing] = await db
    .select({ id: records.id })
    .from(records)
    .innerJoin(sources, eq(sources.id, records.sourceId))
    .where(
      and(
        eq(records.townId, townId),
        eq(sources.platform, 'inbox'),
        eq(records.externalId, externalId),
      ),
    );
  if (existing) return { recordId: existing.id, created: false, townId };

  const text = releaseText(m);
  if (text.length < MIN_RELEASE_CHARS)
    throw new NewsroomError('This message has too little text to write a story from.');
  const title = releaseTitle(m.subject);
  const sourceId = await inboxSource(db, townId, kind);
  const now = input.now ?? new Date();
  const [made] = await db
    .insert(records)
    .values({
      sourceId,
      townId,
      externalId,
      type: 'release',
      title,
      text,
      // No public address: the release lives in our inbox. Its story cites the release by title.
      url: null,
      occurredAt: m.sentAt,
      raw: {
        messageId: m.rfcMessageId,
        inboxMessageId: m.id,
        threadId: row.threadId,
        from: m.fromAddress,
        fromName: m.fromName,
        subject: m.subject,
        sentAt: m.sentAt.toISOString(),
        sentToNewsroomAt: now.toISOString(),
        sentBy: input.staffId,
        fromOrganizationConfirmed: true,
      },
      contentHash: createHash('sha256').update(`${title}\n${text}`).digest('hex'),
    })
    .onConflictDoNothing()
    .returning({ id: records.id });
  if (!made) {
    // Another send of the same message under the same kind won the race.
    const [again] = await db
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.sourceId, sourceId), eq(records.externalId, externalId)));
    return { recordId: again!.id, created: false, townId };
  }
  await logAdminAction(db, {
    staffId: input.staffId,
    action: 'newsroom.send',
    target: { type: 'message', id: m.id },
    detail: { recordId: made.id, townId, kind, sourceId, rfcMessageId: m.rfcMessageId },
  });
  return { recordId: made.id, created: true, townId };
}
