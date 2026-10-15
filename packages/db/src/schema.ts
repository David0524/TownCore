import { sourceKinds, townTiers } from '@towncore/config';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Data model from CLAUDE.md §5. Rules that must hold no matter which code writes a row
// (bylines, sources on published articles, tier range) are CHECK constraints here.

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const townStatus = pgEnum('town_status', ['draft', 'live', 'paused']);
export const townTier = pgEnum('town_tier', townTiers);
export const sourceKind = pgEnum('source_kind', sourceKinds);
export const sourceHealth = pgEnum('source_health', ['ok', 'degraded', 'broken']);
export const candidateStatus = pgEnum('candidate_status', [
  'pending',
  'writing',
  'written',
  'dropped',
]);
export const articleStatus = pgEnum('article_status', [
  'draft',
  'in_review',
  'published',
  'rejected',
  'blocked',
  'corrected',
]);
export const placementProduct = pgEnum('placement_product', [
  'enhanced',
  'sponsored_slot',
  'exclusive',
  'newsletter',
  'spotlight',
]);
export const placementStatus = pgEnum('placement_status', [
  'pending',
  'active',
  'canceled',
  'expired',
]);
export const leadKind = pgEnum('lead_kind', ['call', 'form']);
export const subscriberStatus = pgEnum('subscriber_status', [
  'pending',
  'active',
  'unsubscribed',
  'bounced',
  'complained',
]);
export const staffRole = pgEnum('staff_role', ['admin', 'reviewer']);

export const towns = pgTable('towns', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  censusId: text('census_id'),
  county: text('county').notNull(),
  timezone: text('timezone').notNull(),
  domain: text('domain').notNull().unique(),
  extraDomains: text('extra_domains')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  siteName: text('site_name').notNull(),
  status: townStatus('status').notNull().default('draft'),
  tier: townTier('tier').notNull(),
  config: jsonb('config').notNull(),
  readinessScore: real('readiness_score'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const staff = pgTable('staff', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: staffRole('role').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sources = pgTable(
  'sources',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    kind: sourceKind('kind').notNull(),
    platform: text('platform').notNull(),
    url: text('url'),
    adapter: text('adapter').notNull(),
    schedule: text('schedule'),
    config: jsonb('config').notNull().default({}),
    health: sourceHealth('health').notNull().default('ok'),
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sources_town_idx').on(t.townId)],
);

export const records = pgTable(
  'records',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    externalId: text('external_id').notNull(),
    type: text('type').notNull(),
    title: text('title'),
    text: text('text'),
    url: text('url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    raw: jsonb('raw'),
    contentHash: text('content_hash').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('records_source_external_uq').on(t.sourceId, t.externalId),
    index('records_town_occurred_idx').on(t.townId, t.occurredAt),
  ],
);

export const storyCandidates = pgTable(
  'story_candidates',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    recordIds: uuid('record_ids').array().notNull(),
    beat: text('beat').notNull(),
    proposedTier: smallint('proposed_tier').notNull(),
    newsworthiness: real('newsworthiness'),
    status: candidateStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('story_candidates_town_status_idx').on(t.townId, t.status),
    check('story_candidates_tier_range', sql`${t.proposedTier} between 1 and 4`),
  ],
);

export const articles = pgTable(
  'articles',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    slug: text('slug').notNull(),
    headline: text('headline').notNull(),
    dek: text('dek'),
    bodyMd: text('body_md').notNull(),
    beat: text('beat').notNull(),
    tier: smallint('tier').notNull(),
    status: articleStatus('status').notNull().default('draft'),
    byline: text('byline').notNull(),
    reviewerId: uuid('reviewer_id').references(() => staff.id),
    sourceRecordIds: uuid('source_record_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    claims: jsonb('claims'),
    factcheck: jsonb('factcheck'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('articles_town_slug_uq').on(t.townId, t.slug),
    index('articles_town_status_published_idx').on(t.townId, t.status, t.publishedAt.desc()),
    check('articles_tier_range', sql`${t.tier} between 1 and 4`),
    // Rule 5: Tier 4 is never public.
    check(
      'articles_tier4_never_public',
      sql`${t.tier} < 4 or ${t.status} in ('blocked', 'rejected')`,
    ),
    // Rule 2: honest bylines on anything public.
    check(
      'articles_public_byline',
      sql`${t.status} not in ('published', 'corrected') or ${t.byline} like '% Newsroom (AI-assisted)%'`,
    ),
    // Rule 4: every public article cites at least one source record.
    check(
      'articles_public_sources',
      sql`${t.status} not in ('published', 'corrected') or cardinality(${t.sourceRecordIds}) > 0`,
    ),
    check(
      'articles_public_published_at',
      sql`${t.status} not in ('published', 'corrected') or ${t.publishedAt} is not null`,
    ),
  ],
);

export const corrections = pgTable(
  'corrections',
  {
    id: id(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'restrict' }),
    note: text('note').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('corrections_article_idx').on(t.articleId)],
);

export const businesses = pgTable(
  'businesses',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    name: text('name').notNull(),
    category: text('category'),
    address: text('address'),
    phone: text('phone'),
    website: text('website'),
    licenseType: text('license_type'),
    licenseNumber: text('license_number'),
    licenseVerified: boolean('license_verified').notNull().default(false),
    dataSource: text('data_source').notNull(),
    claimedByEmail: text('claimed_by_email'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('businesses_town_category_idx').on(t.townId, t.category)],
);

export const placements = pgTable(
  'placements',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    product: placementProduct('product').notNull(),
    category: text('category'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: placementStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('placements_town_product_idx').on(t.townId, t.product, t.category)],
);

export const leads = pgTable(
  'leads',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    kind: leadKind('kind').notNull(),
    meta: jsonb('meta'),
    createdAt: createdAt(),
  },
  (t) => [index('leads_business_created_idx').on(t.businessId, t.createdAt)],
);

export const subscribers = pgTable(
  'subscribers',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    email: text('email').notNull(),
    status: subscriberStatus('status').notNull().default('pending'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    source: text('source'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('subscribers_town_email_uq').on(t.townId, sql`lower(${t.email})`)],
);

export const newsletterIssues = pgTable(
  'newsletter_issues',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    date: date('date').notNull(),
    articleIds: uuid('article_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    sponsorPlacementId: uuid('sponsor_placement_id').references(() => placements.id),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    stats: jsonb('stats'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('newsletter_issues_town_date_uq').on(t.townId, t.date)],
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    // Null for network-level jobs (e.g. launcher discovery before a town row exists).
    townId: uuid('town_id').references(() => towns.id),
    job: text('job').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    estCostUsd: numeric('est_cost_usd', { precision: 10, scale: 4 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_town_created_idx').on(t.townId, t.createdAt)],
);

// Liveness of worker processes (one row per process, upserted by the heartbeat job).
export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }).notNull(),
});
