import { directoryCategory, entityKey } from '@towncore/config';
import {
  and,
  articleEntities,
  articles,
  asc,
  businesses,
  entities,
  eq,
  gte,
  inArray,
  logAdminAction,
  ne,
  outreachDrafts,
  suppressions,
  towns,
  type Db,
} from '@towncore/db';
import { parseAddress, sendNew, type Actor, type SendDeps, type SendResult } from '@towncore/mail';
import { townMailDomain } from './mail';

// Outreach drafts (CLAUDE.md §11 "business triggers"; docs/plans/M6.md §6). When a published
// story names a listed business, or was written from its license record, the system drafts a
// short email: "you were in today's story; your listing is here". Nothing is sent by code
// (Rule 10): staff review the draft, add an address for unclaimed listings (found on the
// business's own website, never guessed), and press Send, which opens an inbox conversation.

/** Stories published this recently are considered. */
const LOOKBACK_DAYS = 7;
/** A business gets at most one draft in this many days, so a busy week isn't five emails. */
const QUIET_DAYS = 30;
/** Replies land with the sales team in the shared inbox. */
export const OUTREACH_LOCAL_PART = 'sales';

export type OutreachReport = { created: number };

type Listing = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  claimedAt: Date | null;
  claimedByEmail: string | null;
};
type Story = { id: string; slug: string; headline: string; publishedAt: Date | null };

const dayMs = 86_400_000;

/**
 * Drafts outreach for the town's recent stories. A business is matched when the story names it
 * (its topic entity has the listing's name key) or was written from its own license record.
 * Roundups and alerts are skipped: one roundup names dozens of new filings.
 */
export async function draftOutreach(
  db: Db,
  townId: string,
  opts: { now?: Date; postalAddress?: string | null } = {},
): Promise<OutreachReport> {
  const now = opts.now ?? new Date();
  const [town] = await db.select().from(towns).where(eq(towns.id, townId));
  if (!town) throw new Error(`Unknown town ${townId}`);
  const stories = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      headline: articles.headline,
      publishedAt: articles.publishedAt,
      sourceRecordIds: articles.sourceRecordIds,
    })
    .from(articles)
    .where(
      and(
        eq(articles.townId, townId),
        inArray(articles.status, ['published', 'corrected']),
        eq(articles.kind, 'story'),
        gte(articles.publishedAt, new Date(now.getTime() - LOOKBACK_DAYS * dayMs)),
      ),
    )
    .orderBy(asc(articles.publishedAt));
  if (stories.length === 0) return { created: 0 };

  const named = await db
    .select({ articleId: articleEntities.articleId, key: entities.key })
    .from(articleEntities)
    .innerJoin(entities, eq(entities.id, articleEntities.entityId))
    .where(
      and(
        eq(entities.kind, 'business'),
        inArray(
          articleEntities.articleId,
          stories.map((s) => s.id),
        ),
      ),
    );
  const recordIds = stories.flatMap((s) => s.sourceRecordIds);
  if (named.length === 0 && recordIds.length === 0) return { created: 0 };

  const listings = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      category: businesses.category,
      claimedAt: businesses.claimedAt,
      claimedByEmail: businesses.claimedByEmail,
      sourceRecordId: businesses.sourceRecordId,
    })
    .from(businesses)
    .where(and(eq(businesses.townId, townId), eq(businesses.active, true)));
  const byKey = new Map<string, Listing[]>();
  const byRecord = new Map<string, Listing>();
  for (const l of listings) {
    const key = entityKey('business', l.name);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), l]);
    if (l.sourceRecordId) byRecord.set(l.sourceRecordId, l);
  }

  const matches: Array<{ story: Story; listing: Listing }> = [];
  for (const story of stories) {
    const found = new Map<string, Listing>();
    for (const n of named.filter((x) => x.articleId === story.id)) {
      const same = byKey.get(n.key) ?? [];
      // Two listings with one name: we can't tell which the story means, so neither.
      if (same.length === 1) found.set(same[0]!.id, same[0]!);
    }
    for (const rid of story.sourceRecordIds) {
      const l = byRecord.get(rid);
      if (l) found.set(l.id, l);
    }
    for (const listing of found.values()) matches.push({ story, listing });
  }
  if (matches.length === 0) return { created: 0 };

  const recent = await db
    .select({ businessId: outreachDrafts.businessId })
    .from(outreachDrafts)
    .where(
      and(
        inArray(
          outreachDrafts.businessId,
          matches.map((m) => m.listing.id),
        ),
        gte(outreachDrafts.createdAt, new Date(now.getTime() - QUIET_DAYS * dayMs)),
      ),
    );
  const quiet = new Set(recent.map((r) => r.businessId));
  // A business that asked us not to email it (a manual suppression, a bounce or a complaint on
  // the owner's address or one we wrote to before) gets no more drafts.
  const known = await db
    .select({ businessId: outreachDrafts.businessId, email: outreachDrafts.toEmail })
    .from(outreachDrafts)
    .where(
      and(
        inArray(
          outreachDrafts.businessId,
          matches.map((m) => m.listing.id),
        ),
        eq(outreachDrafts.status, 'sent'),
      ),
    );
  const addresses = new Map<string, string[]>();
  for (const { businessId, email } of [
    ...known,
    ...matches.map((m) => ({ businessId: m.listing.id, email: m.listing.claimedByEmail })),
  ]) {
    if (email)
      addresses.set(businessId, [...(addresses.get(businessId) ?? []), email.toLowerCase()]);
  }
  const all = [...new Set([...addresses.values()].flat())];
  const blocked = new Set(
    all.length
      ? (
          await db
            .select({ email: suppressions.email })
            .from(suppressions)
            .where(and(inArray(suppressions.email, all), ne(suppressions.reason, 'unsubscribe')))
        ).map((r) => r.email)
      : [],
  );
  for (const [businessId, emails] of addresses)
    if (emails.some((e) => blocked.has(e))) quiet.add(businessId);
  let created = 0;
  for (const { story, listing } of matches) {
    if (quiet.has(listing.id)) continue;
    const draft = outreachMessage(
      { siteName: town.siteName, domain: town.domain, postalAddress: opts.postalAddress ?? null },
      story,
      listing,
    );
    const [row] = await db
      .insert(outreachDrafts)
      .values({
        townId,
        businessId: listing.id,
        articleId: story.id,
        toEmail: listing.claimedAt ? listing.claimedByEmail : null,
        subject: draft.subject,
        body: draft.body,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: outreachDrafts.id });
    if (row) {
      created++;
      quiet.add(listing.id);
    }
  }
  return { created };
}

/** The draft's subject and plain-text body. Staff can edit both before sending. */
export function outreachMessage(
  town: { siteName: string; domain: string; postalAddress: string | null },
  story: Story,
  listing: Listing,
): { subject: string; body: string } {
  const origin = `https://${town.domain}`;
  const category = directoryCategory(listing.category ?? '');
  const listingUrl = category
    ? `${origin}/directory/${category.slug}/${listing.slug}`
    : `${origin}/directory`;
  const date = story.publishedAt
    ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
        story.publishedAt,
      )
    : 'recently';
  const listingLines = listing.claimedAt
    ? [
        `Your listing in our local directory is here: ${listingUrl}`,
        `You can update its hours, phone number and description any time from ${origin}/owner.`,
      ]
    : [
        `${listing.name} also has a free listing in our local directory, built from its state license record: ${listingUrl}`,
        'If you run the business, you can claim the listing for free to add your hours, phone number and a short description. There is a "Claim this listing" button on the page.',
      ];
  return {
    subject: `${listing.name} in ${town.siteName}`,
    body: [
      'Hello,',
      `${town.siteName} mentioned ${listing.name} in a story published on ${date}: "${story.headline}"`,
      `${origin}/news/${story.slug}`,
      ...listingLines,
      'If you’d rather we didn’t email you about stories, reply "no thanks" and we won’t.',
      ...(town.postalAddress ? [`${town.siteName} · ${town.postalAddress}`] : []),
    ].join('\n\n'),
  };
}

export type PendingOutreach = {
  id: string;
  toEmail: string | null;
  subject: string;
  body: string;
  createdAt: Date;
  business: { name: string; slug: string; category: string | null; claimed: boolean };
  article: { headline: string; slug: string };
  town: { id: string; name: string; domain: string };
};

/** Drafts waiting for a person, oldest first. */
export async function pendingOutreach(db: Db, limit = 50): Promise<PendingOutreach[]> {
  const rows = await db
    .select({ draft: outreachDrafts, business: businesses, article: articles, town: towns })
    .from(outreachDrafts)
    .innerJoin(businesses, eq(businesses.id, outreachDrafts.businessId))
    .innerJoin(articles, eq(articles.id, outreachDrafts.articleId))
    .innerJoin(towns, eq(towns.id, outreachDrafts.townId))
    .where(eq(outreachDrafts.status, 'draft'))
    .orderBy(asc(outreachDrafts.createdAt))
    .limit(limit);
  return rows.map(({ draft, business, article, town }) => ({
    id: draft.id,
    toEmail: draft.toEmail,
    subject: draft.subject,
    body: draft.body,
    createdAt: draft.createdAt,
    business: {
      name: business.name,
      slug: business.slug,
      category: business.category,
      claimed: business.claimedAt !== null,
    },
    article: { headline: article.headline, slug: article.slug },
    town: { id: town.id, name: town.name, domain: town.domain },
  }));
}

export class OutreachError extends Error {}

async function waitingDraft(db: Db, draftId: string) {
  const [draft] = await db
    .select()
    .from(outreachDrafts)
    .where(and(eq(outreachDrafts.id, draftId), eq(outreachDrafts.status, 'draft')));
  if (!draft) throw new OutreachError('This draft was already sent or dismissed.');
  return draft;
}

/**
 * Sends a draft as a new inbox conversation from the town's sales@ address. Pressing Send is
 * the human approval (Rule 10); the send itself goes through the inbox's own path, so
 * suppressions and the "send anyway" confirmation apply as for any staff message.
 */
export async function sendOutreach(
  deps: SendDeps,
  actor: Actor,
  input: {
    draftId: string;
    to: string;
    subject: string;
    body: string;
    confirmSuppressed: boolean;
  },
): Promise<SendResult> {
  const draft = await waitingDraft(deps.db, input.draftId);
  const to = parseAddress(input.to.trim())?.address;
  if (!to) throw new OutreachError('Add the business’s email address first.');
  const mail = await townMailDomain(deps.db, draft.townId);
  if (!mail) throw new OutreachError('This town’s mail domain isn’t live yet.');
  const result = await sendNew(deps, actor, {
    domainId: mail.domainId,
    localPart: OUTREACH_LOCAL_PART,
    to: [to],
    cc: [],
    subject: input.subject,
    body: input.body,
    attachments: [],
    confirmSuppressed: input.confirmSuppressed,
  });
  await deps.db
    .update(outreachDrafts)
    .set({
      status: 'sent',
      toEmail: to,
      subject: input.subject.trim(),
      body: input.body,
      threadId: result.threadId,
      decidedBy: actor.id,
      decidedAt: deps.now?.() ?? new Date(),
    })
    .where(eq(outreachDrafts.id, draft.id));
  await logAdminAction(deps.db, {
    staffId: actor.id,
    action: 'directory.outreach.send',
    target: { type: 'outreach_draft', id: draft.id },
    detail: { businessId: draft.businessId, articleId: draft.articleId, threadId: result.threadId },
  });
  return result;
}

export async function dismissOutreach(
  db: Db,
  input: { draftId: string; staffId: string },
  now = new Date(),
): Promise<void> {
  const draft = await waitingDraft(db, input.draftId);
  await db
    .update(outreachDrafts)
    .set({ status: 'dismissed', decidedBy: input.staffId, decidedAt: now })
    .where(eq(outreachDrafts.id, draft.id));
  await logAdminAction(db, {
    staffId: input.staffId,
    action: 'directory.outreach.dismiss',
    target: { type: 'outreach_draft', id: draft.id },
    detail: { businessId: draft.businessId, articleId: draft.articleId },
  });
}
