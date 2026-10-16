import { sourceKinds, townTiers, type WeatherSnapshot } from '@towncore/config';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
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
// pending → accepted (to be written) | skipped (logged in skipped_candidates) | dropped (Tier 4)
// accepted → writing → written
export const candidateStatus = pgEnum('candidate_status', [
  'pending',
  'accepted',
  'skipped',
  'writing',
  'written',
  'dropped',
]);
// story: one source item written by the writer; roundup / template: built in code from
// structured records; update: a follow-up note on a published article (CLAUDE.md §6a).
export const candidateKind = pgEnum('candidate_kind', ['story', 'roundup', 'template', 'update']);
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
  // Paid, but over the category's inventory: never shown; staff refund it in Stripe (D-M6-5).
  'held',
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
export const sourceRunStatus = pgEnum('source_run_status', ['running', 'ok', 'failed']);
export const campaignStatus = pgEnum('campaign_status', ['draft', 'active', 'paused', 'ended']);

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
  // Town theme (CLAUDE.md §11a); null means the network default theme.
  theme: jsonb('theme'),
  readinessScore: real('readiness_score'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const staff = pgTable('staff', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: staffRole('role').notNull(),
  // A stand-in reviewer used before a real one is named (CLAUDE.md Decisions, 2026-10-15).
  // Never allowed on a live town's published story (Rule 2).
  placeholder: boolean('placeholder').notNull().default(false),
  // Deactivated staff keep their history but can't sign in (sessions stop working at once).
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Staff sign-in by email link (CLAUDE.md §3). Only SHA-256 hashes of tokens are stored.
export const staffLoginTokens = pgTable(
  'staff_login_tokens',
  {
    id: id(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('staff_login_tokens_hash_uq').on(t.tokenHash),
    index('staff_login_tokens_staff_created_idx').on(t.staffId, t.createdAt),
  ],
);

export const staffSessions = pgTable(
  'staff_sessions',
  {
    id: id(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('staff_sessions_hash_uq').on(t.tokenHash)],
);

// The audit log for every staff action in /admin: editorial actions, and mail sends,
// assignments, imports, onboarding, pauses and settings (D-MAIL-5). Editorial rows keep their
// article/candidate columns; everything else names its target by type and id.
export const adminActions = pgTable(
  'admin_actions',
  {
    id: id(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    action: text('action').notNull(),
    articleId: uuid('article_id'),
    candidateId: uuid('candidate_id'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_actions_created_idx').on(t.createdAt),
    index('admin_actions_target_idx').on(t.targetType, t.targetId),
    check('admin_actions_target_pair', sql`(${t.targetType} is null) = (${t.targetId} is null)`),
  ],
);

// Mail routing (docs/plans/MAIL.md, D-MAIL-3). Teams are central: no per-town staff.
export const teams = pgTable('teams', {
  id: id(),
  name: text('name').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.staffId] })],
);

// Global role addresses: `sales@` on any town domain goes to the same team. The one catch-all
// row has no local part and takes every address that matches no role.
export const roleAddresses = pgTable(
  'role_addresses',
  {
    id: id(),
    localPart: text('local_part').unique(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    isCatchAll: boolean('is_catch_all').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('role_addresses_one_catch_all_uq')
      .on(t.isCatchAll)
      .where(sql`${t.isCatchAll}`),
    check('role_addresses_catch_all_shape', sql`${t.isCatchAll} = (${t.localPart} is null)`),
    check('role_addresses_local_part', sql`${t.localPart} ~ '^[a-z0-9][a-z0-9._-]*$'`),
  ],
);

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
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
    // Stable identity for sources synced from town YAML ("kind:platform:url-or-zone").
    key: text('key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sources_town_idx').on(t.townId),
    uniqueIndex('sources_town_key_uq').on(t.townId, t.key),
  ],
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
    // Set when an existing record's content changes (feeds M3 follow-ups).
    changedAt: timestamp('changed_at', { withTimezone: true }),
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
    kind: candidateKind('kind').notNull().default('story'),
    // Dedupe key per town, e.g. "record:<id>" or "roundup:new-businesses:2026-10-12".
    key: text('key').notNull(),
    title: text('title'),
    // Classifier answer and the tier router's reasons (CLAUDE.md §7).
    classification: jsonb('classification'),
    tierReasons: text('tier_reasons').array(),
    articleId: uuid('article_id'),
    // For kind=update: the published article the note is added to (CLAUDE.md §6a follow-ups).
    targetArticleId: uuid('target_article_id'),
    // Must be written whatever its score or the budget (e.g. charges dropped, §6a).
    mustWrite: boolean('must_write').notNull().default(false),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('story_candidates_town_status_idx').on(t.townId, t.status),
    uniqueIndex('story_candidates_town_key_uq').on(t.townId, t.key),
    check('story_candidates_tier_range', sql`${t.proposedTier} between 1 and 4`),
  ],
);

// Newsworthiness and its components for each candidate (CLAUDE.md §6a), kept so the weights in
// packages/pipeline/src/scoring.ts can be tuned from data.
export const articleScores = pgTable(
  'article_scores',
  {
    id: id(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => storyCandidates.id),
    articleId: uuid('article_id'),
    newsworthiness: real('newsworthiness').notNull(),
    components: jsonb('components').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('article_scores_candidate_idx').on(t.candidateId)],
);

// Why a candidate wasn't written (CLAUDE.md §6a skip log), for review in /admin/skipped.
export const skipReason = pgEnum('skip_reason', [
  'below_threshold',
  'budget_full',
  'public_safety_cap',
  'duplicate',
  'wrong_town',
  'thin_source',
  'tier4',
  'other_outlet',
  // The classifier refused or returned unusable output; a reviewer can still write it.
  'model_error',
]);
export const skippedCandidates = pgTable(
  'skipped_candidates',
  {
    id: id(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => storyCandidates.id),
    reason: skipReason('reason').notNull(),
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('skipped_candidates_candidate_uq').on(t.candidateId)],
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
    candidateId: uuid('candidate_id'),
    // story | roundup | alert | guide: sets its freshness half-life in ranking (CLAUDE.md §6a).
    kind: text('kind').notNull().default('story'),
    // e.g. ["writer@v1", "factcheck@v1"]: the prompts that produced this article.
    promptVersions: text('prompt_versions').array(),
    // Why it's in the review queue: tier3 | sample | factcheck | model_error | minor_override.
    reviewReason: text('review_reason'),
    tierReasons: text('tier_reasons').array(),
    rejectionReason: text('rejection_reason'),
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

// Dated update notes on published stories (CLAUDE.md §6a follow-ups). Shown on the article
// once published; pending ones wait in /admin/review.
export const updateStatus = pgEnum('update_status', ['in_review', 'published', 'rejected']);
export const articleUpdates = pgTable(
  'article_updates',
  {
    id: id(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id),
    candidateId: uuid('candidate_id'),
    noteMd: text('note_md').notNull(),
    recordIds: uuid('record_ids').array().notNull(),
    tier: smallint('tier').notNull(),
    status: updateStatus('status').notNull(),
    reviewReason: text('review_reason'),
    factcheck: jsonb('factcheck'),
    reviewerId: uuid('reviewer_id').references(() => staff.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('article_updates_article_idx').on(t.articleId)],
);

// Links between related stories, e.g. a new story that follows up an earlier one.
export const articleLinks = pgTable(
  'article_links',
  {
    id: id(),
    fromArticleId: uuid('from_article_id')
      .notNull()
      .references(() => articles.id),
    toArticleId: uuid('to_article_id')
      .notNull()
      .references(() => articles.id),
    kind: text('kind').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('article_links_uq').on(t.fromArticleId, t.toArticleId, t.kind)],
);

// Pinned stories (CLAUDE.md §6a): staff pins, and auto-pins for severe weather and road closures.
export const pins = pgTable(
  'pins',
  {
    id: id(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    reason: text('reason').notNull(),
    // Null for automatic pins.
    createdBy: uuid('created_by').references(() => staff.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('pins_town_expires_idx').on(t.townId, t.expiresAt)],
);

// The Today weather tile per town (docs/plans/M4b.md): the latest NWS snapshot, refreshed every
// 15 minutes by the worker. Display data only; stories still come from weather records.
export const townWeather = pgTable('town_weather', {
  townId: uuid('town_id')
    .primaryKey()
    .references(() => towns.id),
  snapshot: jsonb('snapshot').$type<WeatherSnapshot>(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
});

// First-party, cookieless engagement counters per article and day (D-M4-3). No cookies, no IP
// addresses, no user identifiers: only counts.
export const articleStatsDaily = pgTable(
  'article_stats_daily',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    day: date('day').notNull(),
    views: integer('views').notNull().default(0),
    listImpressions: integer('list_impressions').notNull().default(0),
    listClicks: integer('list_clicks').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.day] }),
    index('article_stats_town_day_idx').on(t.townId, t.day),
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
    // Stable public path: name plus license number, e.g. "bagel-city-south-sea6010779".
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    /** Street address. Shown only once the listing is claimed (D-M6-2). */
    address: text('address'),
    city: text('city'),
    zip: text('zip'),
    phone: text('phone'),
    website: text('website'),
    licenseType: text('license_type'),
    licenseNumber: text('license_number'),
    licenseVerified: boolean('license_verified').notNull().default(false),
    licenseExpiresAt: timestamp('license_expires_at', { withTimezone: true }),
    dataSource: text('data_source').notNull(),
    /** The state record this listing was seeded from, kept current by each seeding run. */
    sourceRecordId: uuid('source_record_id').references(() => records.id),
    /** Listed only while the state license is active (D-M6-1). Never deleted. */
    active: boolean('active').notNull().default(true),
    // Census geocoding (D-M6-3). Coordinates of an unclaimed listing are never shown, since
    // many are home addresses; they only decide whether it is inside city limits.
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    inCityLimits: boolean('in_city_limits'),
    geocodeStatus: text('geocode_status'),
    geocodedAt: timestamp('geocoded_at', { withTimezone: true }),
    claimedByEmail: text('claimed_by_email'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Owner-edited fields (M6 PR C). A new name waits in pending_name for staff review.
    description: text('description'),
    hours: text('hours'),
    serviceArea: text('service_area'),
    pendingName: text('pending_name'),
    ownerUpdatedAt: timestamp('owner_updated_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('businesses_town_category_idx').on(t.townId, t.category),
    uniqueIndex('businesses_town_slug_uq').on(t.townId, t.slug),
    uniqueIndex('businesses_town_license_uq').on(t.townId, t.dataSource, t.licenseNumber),
    check(
      'businesses_geocode_status',
      sql`${t.geocodeStatus} is null or ${t.geocodeStatus} in ('match', 'no_match')`,
    ),
  ],
);

export const businessClaimStatus = pgEnum('business_claim_status', [
  'unverified',
  'pending',
  'approved',
  'rejected',
]);

// Claims on directory listings (M6 PR C, D-M6-4): the person verifies the email address they
// entered, then staff approve. Only hashes of the verification tokens are stored.
export const businessClaims = pgTable(
  'business_claims',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    claimantName: text('claimant_name').notNull(),
    claimantRole: text('claimant_role').notNull(),
    email: text('email').notNull(),
    status: businessClaimStatus('status').notNull().default('unverified'),
    verifyTokenHash: text('verify_token_hash'),
    verifyExpiresAt: timestamp('verify_expires_at', { withTimezone: true }),
    verifySentAt: timestamp('verify_sent_at', { withTimezone: true }),
    verifySendsToday: integer('verify_sends_today').notNull().default(0),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ip: text('ip'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('business_claims_business_status_idx').on(t.businessId, t.status),
    index('business_claims_town_status_idx').on(t.townId, t.status, t.createdAt),
    index('business_claims_ip_created_idx').on(t.ip, t.createdAt),
    uniqueIndex('business_claims_verify_hash_uq').on(t.verifyTokenHash),
  ],
);

// Owner sign-in by email link (D-M6-11), per town site: single-use link tokens and sessions,
// stored as SHA-256 hashes like staff sign-in.
export const ownerLoginTokens = pgTable(
  'owner_login_tokens',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('owner_login_tokens_hash_uq').on(t.tokenHash),
    index('owner_login_tokens_email_created_idx').on(t.townId, t.email, t.createdAt),
  ],
);

export const ownerSessions = pgTable(
  'owner_sessions',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('owner_sessions_hash_uq').on(t.tokenHash)],
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
    stripeCustomerId: text('stripe_customer_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePriceId: text('stripe_price_id'),
    /** The owner who bought it (their claim's email). */
    buyerEmail: text('buyer_email'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: placementStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('placements_town_product_idx').on(t.townId, t.product, t.category),
    uniqueIndex('placements_checkout_session_uq').on(t.stripeCheckoutSessionId),
    uniqueIndex('placements_subscription_uq').on(t.stripeSubscriptionId),
  ],
);

// Stripe Products and Prices per town and product (M6 PR D), made by `pnpm directory:stripe
// sync` from each town's pricing. A changed price makes a new Price; the old row goes inactive.
export const stripePrices = pgTable(
  'stripe_prices',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    product: placementProduct('product').notNull(),
    stripeProductId: text('stripe_product_id').notNull(),
    stripePriceId: text('stripe_price_id').notNull().unique(),
    unitAmountCents: integer('unit_amount_cents').notNull(),
    livemode: boolean('livemode').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('stripe_prices_town_product_idx').on(t.townId, t.product, t.active)],
);

// Every Stripe webhook event, stored once by its id (deliveries are at least once). Only
// verified events are stored; processing is idempotent and retried while processed_at is null.
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  livemode: boolean('livemode').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
});

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
    // Consent evidence (brief §7.3): where and when they asked, from which IP, and when they
    // confirmed by double opt-in (or the approved import that brought them in).
    consentAt: timestamp('consent_at', { withTimezone: true }),
    source: text('source'),
    consentSource: text('consent_source'),
    consentIp: text('consent_ip'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    lastEngagedAt: timestamp('last_engaged_at', { withTimezone: true }),
    // Confirmation emails sent: rate limits (one per 10 minutes, three a day).
    confirmSentAt: timestamp('confirm_sent_at', { withTimezone: true }),
    confirmSendsToday: integer('confirm_sends_today').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscribers_town_email_uq').on(t.townId, sql`lower(${t.email})`),
    index('subscribers_town_status_idx').on(t.townId, t.status),
    index('subscribers_consent_ip_idx').on(t.consentIp, t.createdAt),
    check(
      'subscribers_active_confirmed',
      sql`${t.status} <> 'active' or ${t.confirmedAt} is not null`,
    ),
  ],
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
    // M5: what went out, to whom, and why a day was skipped. One row per town and local date
    // also makes building idempotent: a retried tick never builds a second issue.
    mode: text('mode'),
    subject: text('subject'),
    html: text('html'),
    text: text('text'),
    campaignId: uuid('campaign_id'),
    skippedReason: text('skipped_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    stats: jsonb('stats'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('newsletter_issues_town_date_uq').on(t.townId, t.date),
    check('newsletter_issues_mode', sql`${t.mode} is null or ${t.mode} in ('test', 'live')`),
  ],
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
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    estCostUsd: numeric('est_cost_usd', { precision: 10, scale: 6 }).notNull(),
    provider: text('provider'),
    promptVersion: text('prompt_version'),
    // ok | refused | invalid (output failed its schema) | error (no usable response)
    outcome: text('outcome').notNull().default('ok'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_town_created_idx').on(t.townId, t.createdAt)],
);

// One row per ingest run of a source (CLAUDE.md §6 ingest; health and M8 dashboards).
export const sourceRuns = pgTable(
  'source_runs',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    status: sourceRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    items: integer('items').notNull().default(0),
    newItems: integer('new_items').notNull().default(0),
    changedItems: integer('changed_items').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('source_runs_source_started_idx').on(t.sourceId, t.startedAt)],
);

// Direct-sold campaigns filling monetization slots (CLAUDE.md §11b). First in every slot's fill
// order. `slot` is a slot name such as "home.top"; `creative` is validated by the web app.
export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    slot: text('slot').notNull(),
    /** Directory slots are sold per category (M6); null applies to every page with the slot. */
    category: text('category'),
    placementId: uuid('placement_id').references(() => placements.id),
    creative: jsonb('creative').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    priority: integer('priority').notNull().default(0),
    status: campaignStatus('status').notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('campaigns_town_slot_idx').on(t.townId, t.slot, t.status),
    check('campaigns_dates', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
);

// Liveness of worker processes (one row per process, upserted by the heartbeat job).
export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }).notNull(),
});

// Mail domains and onboarding (docs/plans/MAIL.md Mail-1). One row per domain that receives and
// sends mail. A town domain links to its town; owner-designated test domains have no town.
export const mailDomainStatus = pgEnum('mail_domain_status', [
  'pending',
  'onboarding',
  'live',
  'paused',
  'failed',
  // Mail-6: SES identities and our DNS records deleted; mail history kept.
  'removed',
]);
export const bulkStatus = pgEnum('bulk_status', ['not_started', 'warming', 'active', 'paused']);
export const identityKind = pgEnum('identity_kind', ['root', 'news']);
export const dnsPurpose = pgEnum('dns_purpose', [
  'inbound_mx',
  'dkim',
  'mail_from_mx',
  'mail_from_spf',
  'spf',
  'dmarc',
]);
export const dnsRecordStatus = pgEnum('dns_record_status', ['planned', 'created', 'existing']);
export const onboardingStepStatus = pgEnum('onboarding_step_status', [
  'pending',
  'running',
  'waiting',
  'done',
  'failed',
]);

export const mailDomains = pgTable(
  'mail_domains',
  {
    id: id(),
    name: text('name').notNull().unique(),
    townId: uuid('town_id').references(() => towns.id),
    // Brand name used in From headers; defaults to the town's site name.
    displayName: text('display_name').notNull(),
    isTest: boolean('is_test').notNull().default(false),
    status: mailDomainStatus('status').notNull().default('pending'),
    inboundEnabled: boolean('inbound_enabled').notNull().default(false),
    bulkStatus: bulkStatus('bulk_status').notNull().default('not_started'),
    warmupDay: integer('warmup_day').notNull().default(0),
    bulkDailyCap: integer('bulk_daily_cap').notNull().default(0),
    pausedReason: text('paused_reason'),
    failureReason: text('failure_reason'),
    // CAN-SPAM footer address; null means the company-wide MAIL_POSTAL_ADDRESS.
    postalAddress: text('postal_address'),
    // Warm-up (Mail-5): the cap grows toward this target; breach days in a row hold or step back.
    bulkTargetCap: integer('bulk_target_cap').notNull().default(50_000),
    warmupBreaches: integer('warmup_breaches').notNull().default(0),
    warmupCheckedOn: date('warmup_checked_on'),
    // M5 (D-M5-2): off → test (staff test list) → live (every active subscriber).
    newsletterMode: text('newsletter_mode').notNull().default('off'),
    // D-MAIL-11: an admin's standing approval for the daily newsletter on this domain; set when
    // the mode becomes live.
    newsletterApprovedAt: timestamp('newsletter_approved_at', { withTimezone: true }),
    newsletterApprovedBy: uuid('newsletter_approved_by').references(() => staff.id),
    // A running onboarding holds this lease so two runs never work on one domain at once.
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    // Set by "Re-check" in /admin/mail/domains; the worker's next mail tick clears it.
    recheckRequestedAt: timestamp('recheck_requested_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('mail_domains_name_lower', sql`${t.name} = lower(${t.name})`),
    check('mail_domains_newsletter_mode', sql`${t.newsletterMode} in ('off', 'test', 'live')`),
    check(
      'mail_domains_failed_reason',
      sql`${t.status} <> 'failed' or ${t.failureReason} is not null`,
    ),
  ],
);

export const domainIdentities = pgTable(
  'domain_identities',
  {
    id: id(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomains.id, { onDelete: 'cascade' }),
    kind: identityKind('kind').notNull(),
    // The SES identity: the domain itself, or news.<domain> for bulk mail.
    identityName: text('identity_name').notNull().unique(),
    verificationStatus: text('verification_status'),
    dkimStatus: text('dkim_status'),
    dkimTokens: text('dkim_tokens').array(),
    signingHostedZone: text('signing_hosted_zone'),
    mailFromDomain: text('mail_from_domain'),
    mailFromStatus: text('mail_from_status'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('domain_identities_domain_kind_uq').on(t.domainId, t.kind)],
);

export const dnsRecords = pgTable(
  'dns_records',
  {
    id: id(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomains.id, { onDelete: 'cascade' }),
    purpose: dnsPurpose('purpose').notNull(),
    type: text('type').notNull(),
    // Relative to the domain's zone, '' for the apex (Vercel's convention).
    name: text('name').notNull(),
    value: text('value').notNull(),
    priority: integer('priority'),
    ttl: integer('ttl'),
    vercelRecordId: text('vercel_record_id'),
    status: dnsRecordStatus('status').notNull().default('planned'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('dns_records_domain_record_uq').on(t.domainId, t.type, t.name, t.value)],
);

export const onboardingSteps = pgTable(
  'onboarding_steps',
  {
    id: id(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomains.id, { onDelete: 'cascade' }),
    step: text('step').notNull(),
    status: onboardingStepStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('onboarding_steps_domain_step_uq').on(t.domainId, t.step)],
);

// Conversations: the shared inbox (docs/plans/MAIL.md, Mail-2+). One thread is one conversation
// between a contact and one exact town address, owned by a central team.
export const threadStatus = pgEnum('thread_status', ['open', 'pending', 'closed', 'spam']);
export const messageDirection = pgEnum('message_direction', ['inbound', 'outbound']);
export const mailEventStatus = pgEnum('mail_event_status', [
  'pending',
  'done',
  'dropped',
  'failed',
]);

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    email: text('email').notNull().unique(),
    name: text('name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('contacts_email_lower', sql`${t.email} = lower(${t.email})`)],
);

export const threads = pgTable(
  'threads',
  {
    id: id(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomains.id),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    assigneeId: uuid('assignee_id').references(() => staff.id),
    status: threadStatus('status').notNull().default('open'),
    subject: text('subject').notNull(),
    // Subject without Re:/Fwd: prefixes, lowercased: the threading fallback key.
    normalizedSubject: text('normalized_subject').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    // The exact town address this conversation is with; replies go out from it.
    townAddress: text('town_address').notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('threads_fallback_idx').on(t.contactId, t.townAddress, t.normalizedSubject),
    index('threads_inbox_idx').on(t.teamId, t.status, t.lastMessageAt),
    index('threads_status_recent_idx').on(t.status, t.lastMessageAt),
    index('threads_domain_idx').on(t.domainId),
    index('threads_assignee_idx').on(t.assigneeId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id),
    direction: messageDirection('direction').notNull(),
    rfcMessageId: text('rfc_message_id'),
    inReplyTo: text('in_reply_to'),
    references: text('references')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: text('to_addresses')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ccAddresses: text('cc_addresses')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // SES envelope RCPT TO: the address this copy was delivered to (handles BCC and catch-all).
    envelopeRecipient: text('envelope_recipient'),
    subject: text('subject').notNull(),
    textBody: text('text_body'),
    // Sanitized at ingest; rendered only in a sandboxed iframe (brief §10).
    htmlBodySanitized: text('html_body_sanitized'),
    rawS3Key: text('raw_s3_key'),
    sesMessageId: text('ses_message_id'),
    // Outbound only: other Message-IDs this message may be known by. SES replaces the
    // Message-ID we set, so we keep ours here and match replies on either (Mail-4).
    altMessageIds: text('alt_message_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    deliveryError: text('delivery_error'),
    spamVerdict: text('spam_verdict'),
    virusVerdict: text('virus_verdict'),
    spfVerdict: text('spf_verdict'),
    dkimVerdict: text('dkim_verdict'),
    dmarcVerdict: text('dmarc_verdict'),
    // Auto-Submitted / Precedence: bulk|list / X-Autoreply: never notify or auto-act on it.
    isAutomated: boolean('is_automated').notNull().default(false),
    // Virus verdict FAIL: kept for the record, attachments never shown or extracted.
    quarantined: boolean('quarantined').notNull().default(false),
    sentByStaffId: uuid('sent_by_staff_id').references(() => staff.id),
    deliveryStatus: text('delivery_status'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // An SNS redelivery of the same message to the same recipient never makes a second row.
    uniqueIndex('messages_ses_recipient_uq').on(t.sesMessageId, t.envelopeRecipient),
    index('messages_rfc_id_idx').on(t.rfcMessageId),
    index('messages_thread_idx').on(t.threadId, t.sentAt),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    // Null for quarantined attachments: they stay only inside the raw message.
    s3Key: text('s3_key'),
    contentId: text('content_id'),
    inline: boolean('inline').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('attachments_message_position_uq').on(t.messageId, t.position)],
);

// Internal notes on a thread. Never emailed.
export const notes = pgTable('notes', {
  id: id(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  staffId: uuid('staff_id')
    .notNull()
    .references(() => staff.id),
  body: text('body').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Every SNS notification the webhook accepted (inbound mail now; sending events in Mail-4),
// stored first and processed by the worker, so the webhook returns fast and redeliveries
// are no-ops.
export const mailEvents = pgTable(
  'mail_events',
  {
    id: id(),
    snsMessageId: text('sns_message_id').notNull().unique(),
    topicArn: text('topic_arn').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: mailEventStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('mail_events_due_idx').on(t.status, t.nextAttemptAt)],
);

// Per-person read state for the shared inbox (Mail-3): a thread is unread for someone when it
// has a message newer than their read mark, or they have never opened it.
export const threadReads = pgTable(
  'thread_reads',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.staffId] })],
);

// Addresses we must not mail (brief §6, §7.2). Checked before every send in both streams:
// hard bounces, complaints and manual blocks stop all mail to the address; an unsubscribe
// (Mail-5) stops only bulk mail. Scope 'domain' applies to one town domain only.
export const suppressionScope = pgEnum('suppression_scope', ['global', 'domain']);
export const suppressionReason = pgEnum('suppression_reason', [
  'hard_bounce',
  'complaint',
  'unsubscribe',
  'manual',
]);

export const suppressions = pgTable(
  'suppressions',
  {
    id: id(),
    email: text('email').notNull(),
    scope: suppressionScope('scope').notNull(),
    domainId: uuid('domain_id').references(() => mailDomains.id, { onDelete: 'cascade' }),
    reason: suppressionReason('reason').notNull(),
    sourceEventId: uuid('source_event_id').references(() => mailEvents.id),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('suppressions_email_reason_domain_uq')
      .on(t.email, t.reason, t.domainId)
      .nullsNotDistinct(),
    index('suppressions_email_idx').on(t.email),
    check('suppressions_email_lower', sql`${t.email} = lower(${t.email})`),
    check('suppressions_scope_domain', sql`(${t.scope} = 'domain') = (${t.domainId} is not null)`),
  ],
);

// One row per recipient per SES sending event (brief §6), parsed from mail_events, for
// delivery status, suppression and domain health metrics.
export const emailEvents = pgTable(
  'email_events',
  {
    id: id(),
    mailEventId: uuid('mail_event_id')
      .notNull()
      .references(() => mailEvents.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    subType: text('sub_type'),
    sesMessageId: text('ses_message_id').notNull(),
    recipient: text('recipient').notNull(),
    configurationSet: text('configuration_set'),
    // From the message's domain_id and stream tags (Mail-5); null for mail sent before them.
    domainId: uuid('domain_id').references(() => mailDomains.id, { onDelete: 'set null' }),
    stream: text('stream'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('email_events_event_recipient_uq').on(t.mailEventId, t.recipient),
    index('email_events_ses_idx').on(t.sesMessageId),
  ],
);

// Reply signatures (brief §6): one per person, per role address, or the default (neither).
// Rendered per town at send time with {{town_name}}, {{user_name}}, {{role}}, {{domain}}.
export const signatures = pgTable(
  'signatures',
  {
    id: id(),
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'cascade' }),
    localPart: text('local_part'),
    bodyTemplate: text('body_template').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('signatures_owner_uq').on(t.staffId, t.localPart).nullsNotDistinct()],
);

// Newsletters and bulk mail (docs/plans/MAIL.md, Mail-5).
export const emailCampaignStatus = pgEnum('email_campaign_status', [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'paused',
  'cancelled',
]);
export const emailCampaignKind = pgEnum('email_campaign_kind', ['campaign', 'newsletter']);
export const campaignSendStatus = pgEnum('campaign_send_status', [
  'queued',
  'deferred_cap',
  'sending',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'suppressed',
  'failed',
]);

// One template that fans out to many towns with {{site_name}}, {{town_name}}, {{domain}}.
export const emailCampaignTemplates = pgTable('email_campaign_templates', {
  id: id(),
  name: text('name').notNull(),
  subjectTemplate: text('subject_template').notNull(),
  bodyTemplate: text('body_template').notNull(),
  createdBy: uuid('created_by').references(() => staff.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const emailCampaigns = pgTable(
  'email_campaigns',
  {
    id: id(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomains.id),
    templateId: uuid('template_id').references(() => emailCampaignTemplates.id),
    kind: emailCampaignKind('kind').notNull().default('campaign'),
    newsletterIssueId: uuid('newsletter_issue_id').references(() => newsletterIssues.id),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    text: text('text').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    status: emailCampaignStatus('status').notNull().default('draft'),
    pausedReason: text('paused_reason'),
    createdBy: uuid('created_by').references(() => staff.id),
    // Rule 10 / D-MAIL-11: who approved this send (null for newsletter issues sent under the
    // domain's standing approval).
    approvedBy: uuid('approved_by').references(() => staff.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    expandedAt: timestamp('expanded_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('email_campaigns_status_idx').on(t.status, t.scheduledAt),
    check(
      'email_campaigns_approved',
      sql`${t.status} in ('draft', 'cancelled') or ${t.kind} = 'newsletter' or ${t.approvedBy} is not null`,
    ),
  ],
);

export const emailCampaignSends = pgTable(
  'email_campaign_sends',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: 'cascade' }),
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => subscribers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    // Warm-up order: most recently confirmed or engaged first.
    priority: timestamp('priority', { withTimezone: true }),
    status: campaignSendStatus('status').notNull().default('queued'),
    sesMessageId: text('ses_message_id'),
    error: text('error'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('email_campaign_sends_uq').on(t.campaignId, t.subscriberId),
    index('email_campaign_sends_status_idx').on(t.campaignId, t.status),
    index('email_campaign_sends_ses_idx').on(t.sesMessageId),
  ],
);

// Per domain, day (UTC) and stream, from SES events: warm-up and auto-pause read this.
export const domainHealthDaily = pgTable(
  'domain_health_daily',
  {
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomains.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    stream: text('stream').notNull(),
    sent: integer('sent').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    bounced: integer('bounced').notNull().default(0),
    complained: integer('complained').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.domainId, t.date, t.stream] })],
);

// Network-wide mail switches, e.g. bulk_paused (brief §7.2).
export const mailSettings = pgTable('mail_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

// The staff who get a town's daily issue while it is in test mode (D-M5-2).
export const newsletterTesters = pgTable(
  'newsletter_testers',
  {
    domainId: uuid('domain_id')
      .notNull()
      .references(() => mailDomains.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.domainId, t.staffId] })],
);

// Mail health alerts (docs/plans/MAIL.md, Mail-6). One open row per condition (its key); the
// worker resolves it when the condition clears. Emailed to admins when new, then once a day.
export const mailAlerts = pgTable(
  'mail_alerts',
  {
    id: id(),
    key: text('key').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedNotifiedAt: timestamp('resolved_notified_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('mail_alerts_open_key_uq')
      .on(t.key)
      .where(sql`${t.resolvedAt} is null`),
    check('mail_alerts_severity', sql`${t.severity} in ('warning', 'critical')`),
  ],
);

// DMARC aggregate (rua) reports (docs/plans/MAIL.md, Mail-6), one row per report: who sent it,
// for which domain and period, and how much mail passed DMARC alignment. `sources` keeps the
// per-IP rows (count, disposition, DKIM and SPF results) for the health page.
export const dmarcReports = pgTable(
  'dmarc_reports',
  {
    id: id(),
    orgName: text('org_name').notNull(),
    reportId: text('report_id').notNull(),
    domain: text('domain').notNull(),
    policy: text('policy'),
    beginAt: timestamp('begin_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    messages: integer('messages').notNull(),
    dkimPass: integer('dkim_pass').notNull(),
    spfPass: integer('spf_pass').notNull(),
    dmarcPass: integer('dmarc_pass').notNull(),
    sources: jsonb('sources').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('dmarc_reports_org_report_uq').on(t.orgName, t.reportId),
    index('dmarc_reports_domain_end_idx').on(t.domain, t.endAt),
  ],
);
