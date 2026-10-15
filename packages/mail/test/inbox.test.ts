import {
  adminActions,
  attachments,
  contacts,
  eq,
  mailDomains,
  messages,
  staff,
  syncMailRouting,
  teamMembers,
  teams,
  threads,
  type Db,
} from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addNote,
  assignThread,
  InboxActionError,
  moveThreadToTeam,
  setThreadStatus,
} from '../src/inbox/actions';
import { getThread, listThreads, markRead, unreadCount } from '../src/inbox/queries';
import { cspFor, hasRemoteImages, messageDocument, rewriteCidImages } from '../src/inbox/render';
import { signAttachment, verifyAttachment } from '../src/inbox/tokens';

let db: Db;
let drop: () => Promise<void>;
const ids: Record<string, string> = {};

async function thread(
  key: string,
  t: {
    team: string;
    domain: string;
    contact: string;
    subject: string;
    at: string;
    status?: 'open' | 'pending' | 'closed' | 'spam';
    assignee?: string;
    body?: string;
  },
) {
  const [c] = await db
    .insert(contacts)
    .values({ email: t.contact, name: t.contact.split('@')[0] })
    .onConflictDoUpdate({ target: contacts.email, set: { email: t.contact } })
    .returning();
  const [row] = await db
    .insert(threads)
    .values({
      domainId: ids[t.domain]!,
      teamId: ids[t.team]!,
      contactId: c!.id,
      townAddress: `sales@${t.domain}`,
      subject: t.subject,
      normalizedSubject: t.subject.toLowerCase(),
      status: t.status ?? 'open',
      assigneeId: t.assignee ? ids[t.assignee] : null,
      lastMessageAt: new Date(t.at),
    })
    .returning();
  await db.insert(messages).values({
    threadId: row!.id,
    direction: 'inbound',
    fromAddress: t.contact,
    subject: t.subject,
    textBody: t.body ?? `Hello about ${t.subject}`,
    sentAt: new Date(t.at),
  });
  ids[key] = row!.id;
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  await syncMailRouting(db);
  for (const t of await db.select().from(teams)) ids[t.name] = t.id;
  const people = await db
    .insert(staff)
    .values([
      { email: 'ana@towncore.net', name: 'Ana', role: 'admin' },
      { email: 'ben@towncore.net', name: 'Ben', role: 'admin' },
      { email: 'gone@towncore.net', name: 'Gone', role: 'admin', active: false },
    ])
    .returning();
  for (const p of people) ids[p.name] = p.id;
  await db.insert(teamMembers).values({ teamId: ids.Sales!, staffId: ids.Ben! });
  const domains = await db
    .insert(mailDomains)
    .values([
      { name: 'boca.test', displayName: 'Boca Town Square', status: 'live', inboundEnabled: true },
      { name: 'harbor.test', displayName: 'Harbor Point', status: 'live', inboundEnabled: true },
    ])
    .returning();
  for (const d of domains) ids[d.name] = d.id;

  await thread('ad', {
    team: 'Sales',
    domain: 'boca.test',
    contact: 'pat@example.com',
    subject: 'Advertising rates',
    at: '2026-10-15T10:00:00Z',
  });
  await thread('tip', {
    team: 'Editorial',
    domain: 'harbor.test',
    contact: 'lee@example.org',
    subject: 'Flooding on Main St',
    at: '2026-10-15T11:00:00Z',
    assignee: 'Ana',
  });
  await thread('old', {
    team: 'Admin',
    domain: 'boca.test',
    contact: 'old@example.com',
    subject: '100% off',
    at: '2026-10-14T09:00:00Z',
    status: 'closed',
  });
  await thread('junk', {
    team: 'Admin',
    domain: 'boca.test',
    contact: 'spam@spam.example',
    subject: 'You won',
    at: '2026-10-15T12:00:00Z',
    status: 'spam',
  });
});
afterAll(async () => drop());

const subjects = (rows: { subject: string }[]) => rows.map((r) => r.subject);

describe('listThreads', () => {
  it('shows active conversations, newest first, with snippet and counts', async () => {
    const { rows, total } = await listThreads(db, ids.Ana!);
    expect(subjects(rows)).toEqual(['Flooding on Main St', 'Advertising rates']);
    expect(total).toBe(2);
    expect(rows[1]).toMatchObject({
      domainName: 'boca.test',
      teamName: 'Sales',
      contactEmail: 'pat@example.com',
      messageCount: 1,
      snippet: 'Hello about Advertising rates',
      unread: true,
      assigneeName: null,
    });
  });

  it('filters by status, team, town and assignee', async () => {
    expect(subjects((await listThreads(db, ids.Ana!, { status: 'spam' })).rows)).toEqual([
      'You won',
    ]);
    expect(subjects((await listThreads(db, ids.Ana!, { status: 'all' })).rows)).toHaveLength(4);
    expect(subjects((await listThreads(db, ids.Ana!, { teamId: ids.Sales })).rows)).toEqual([
      'Advertising rates',
    ]);
    expect(
      subjects((await listThreads(db, ids.Ana!, { domainId: ids['harbor.test'] })).rows),
    ).toEqual(['Flooding on Main St']);
    expect(subjects((await listThreads(db, ids.Ana!, { assignee: 'me' })).rows)).toEqual([
      'Flooding on Main St',
    ]);
    expect(subjects((await listThreads(db, ids.Ana!, { assignee: 'none' })).rows)).toEqual([
      'Advertising rates',
    ]);
  });

  it('searches contact, subject and town, treating % and _ literally', async () => {
    expect(subjects((await listThreads(db, ids.Ana!, { q: 'PAT@' })).rows)).toEqual([
      'Advertising rates',
    ]);
    expect(subjects((await listThreads(db, ids.Ana!, { q: 'flood' })).rows)).toEqual([
      'Flooding on Main St',
    ]);
    expect(subjects((await listThreads(db, ids.Ana!, { q: 'harbor' })).rows)).toEqual([
      'Flooding on Main St',
    ]);
    expect(subjects((await listThreads(db, ids.Ana!, { q: '100%', status: 'all' })).rows)).toEqual([
      '100% off',
    ]);
    expect((await listThreads(db, ids.Ana!, { q: '%', status: 'all' })).rows).toHaveLength(1);
  });

  it('tracks unread per person', async () => {
    await markRead(db, ids.ad!, ids.Ana!, new Date('2026-10-15T10:30:00Z'));
    const forAna = await listThreads(db, ids.Ana!);
    expect(forAna.rows.find((r) => r.id === ids.ad)?.unread).toBe(false);
    expect((await listThreads(db, ids.Ben!)).rows.find((r) => r.id === ids.ad)?.unread).toBe(true);
    expect(subjects((await listThreads(db, ids.Ana!, { unreadOnly: true })).rows)).toEqual([
      'Flooding on Main St',
    ]);

    // A newer message makes it unread again; an older read mark never moves it back.
    await db
      .update(threads)
      .set({ lastMessageAt: new Date('2026-10-15T13:00:00Z') })
      .where(eq(threads.id, ids.ad!));
    expect((await listThreads(db, ids.Ana!)).rows.find((r) => r.id === ids.ad)?.unread).toBe(true);
    await markRead(db, ids.ad!, ids.Ana!, new Date('2026-10-15T14:00:00Z'));
    await markRead(db, ids.ad!, ids.Ana!, new Date('2026-10-15T09:00:00Z'));
    expect((await listThreads(db, ids.Ana!)).rows.find((r) => r.id === ids.ad)?.unread).toBe(false);
  });

  it('counts unread active threads in my teams, or everywhere if I have no team', async () => {
    // Ben is in Sales only.
    expect(await unreadCount(db, ids.Ben!)).toBe(1);
    // Ana has no team: every unread active thread counts (she has read "ad").
    expect(await unreadCount(db, ids.Ana!)).toBe(1);
  });
});

describe('thread actions', () => {
  const ana = () => ({ id: ids.Ana! });

  it('assign, status, move team and spam / not spam are audited', async () => {
    await assignThread(db, ana(), ids.ad!, ids.Ben!);
    await setThreadStatus(db, ana(), ids.ad!, 'pending');
    await moveThreadToTeam(db, ana(), ids.ad!, ids.Editorial!);
    await setThreadStatus(db, ana(), ids.ad!, 'spam');
    await setThreadStatus(db, ana(), ids.ad!, 'open');
    // No-op changes write nothing.
    await assignThread(db, ana(), ids.ad!, ids.Ben!);

    const [row] = await db.select().from(threads).where(eq(threads.id, ids.ad!));
    expect(row).toMatchObject({ assigneeId: ids.Ben, status: 'open', teamId: ids.Editorial });
    const log = await db.select().from(adminActions).where(eq(adminActions.targetId, ids.ad!));
    expect(log.map((l) => l.action)).toEqual([
      'thread_assign',
      'thread_status',
      'thread_move_team',
      'thread_mark_spam',
      'thread_not_spam',
    ]);
    expect(log.every((l) => l.targetType === 'thread' && l.staffId === ids.Ana)).toBe(true);
  });

  it('refuses inactive assignees, unknown teams, empty notes and missing threads', async () => {
    await expect(assignThread(db, ana(), ids.ad!, ids.Gone!)).rejects.toBeInstanceOf(
      InboxActionError,
    );
    await expect(
      moveThreadToTeam(db, ana(), ids.ad!, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('No such team');
    await expect(addNote(db, ana(), ids.ad!, '   ')).rejects.toThrow('empty');
    await expect(
      setThreadStatus(db, ana(), '00000000-0000-0000-0000-000000000000', 'closed'),
    ).rejects.toThrow('No such conversation');
  });

  it('getThread returns messages with attachments and notes', async () => {
    const [m] = await db.select().from(messages).where(eq(messages.threadId, ids.tip!));
    await db.insert(attachments).values({
      messageId: m!.id,
      position: 0,
      filename: 'map.png',
      contentType: 'image/png',
      size: 10,
      s3Key: 'attachments/x/0-map.png',
      contentId: 'map@x',
      inline: true,
    });
    await addNote(db, ana(), ids.tip!, 'Called the city; confirmed.');
    const detail = (await getThread(db, ids.tip!))!;
    expect(detail).toMatchObject({
      domainName: 'harbor.test',
      teamName: 'Editorial',
      assigneeName: 'Ana',
      contactEmail: 'lee@example.org',
    });
    expect(detail.messages[0]!.attachments.map((a) => a.filename)).toEqual(['map.png']);
    expect(detail.notes.map((n) => [n.staffName, n.note.body])).toEqual([
      ['Ana', 'Called the city; confirmed.'],
    ]);
    expect(await getThread(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('message rendering', () => {
  const opts = {
    adminOrigin: 'https://admin.test',
    allowRemoteImages: false,
    inlineUrl: (cid: string) => (cid === 'img1@x' ? 'https://admin.test/i/1?sig="a"' : null),
  };

  it('blocks remote images by default and allows them only when asked', () => {
    expect(cspFor(opts)).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data: https://admin.test; font-src 'none'; form-action 'none'; base-uri 'none'",
    );
    expect(cspFor({ ...opts, allowRemoteImages: true })).toContain(
      'img-src data: https://admin.test https: http:',
    );
  });

  it('rewrites cid: images to signed URLs and drops unknown ones', () => {
    expect(rewriteCidImages('<img src="cid:img1@x"><img src=\'cid:nope\'>', opts.inlineUrl)).toBe(
      '<img src="https://admin.test/i/1?sig=&quot;a&quot;"><img src=\'\'>',
    );
  });

  it('builds a document with the CSP, no referrer and links opening outside', () => {
    const doc = messageDocument('<p>Hi</p>', opts);
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${cspFor(opts)}">`);
    expect(doc).toContain('<meta name="referrer" content="no-referrer">');
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('<body><p>Hi</p></body>');
  });

  it('detects remote images', () => {
    expect(hasRemoteImages('<img width=1 src="https://t.example/p.gif">')).toBe(true);
    expect(hasRemoteImages('<img src="cid:x"><a href="https://x">x</a>')).toBe(false);
  });
});

describe('attachment tokens', () => {
  const secret = 'x'.repeat(32);
  it('verify only the same id, before expiry, with the right secret', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const { exp, sig } = signAttachment(secret, 'att-1', now);
    expect(verifyAttachment(secret, 'att-1', String(exp), sig, now + 60_000)).toBe(true);
    expect(verifyAttachment(secret, 'att-2', String(exp), sig, now)).toBe(false);
    expect(verifyAttachment('y'.repeat(32), 'att-1', String(exp), sig, now)).toBe(false);
    expect(verifyAttachment(secret, 'att-1', String(exp), sig, now + 16 * 60_000)).toBe(false);
    expect(verifyAttachment(secret, 'att-1', String(exp + 1000), sig, now)).toBe(false);
    expect(verifyAttachment(secret, 'att-1', null, sig, now)).toBe(false);
  });
});
