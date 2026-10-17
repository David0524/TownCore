import {
  entityKinds,
  imageKinds,
  sourceKinds,
  townTiers,
  type EntityKind,
  type ImageKind,
  type ImageSpec,
  type TropicsBasin,
  type TropicsSnapshot,
  type WeatherSnapshot,
} from '@towncore/config';
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
export const candidateKind = pgEnum('candidate_kind', [
  'story',
  'roundup',
  'template',
  'update',
  // An evergreen guide to write or rewrite from its topic's pages (M4 PR F).
  'guide',
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
  // Census ACS households (B11001), for subscribers per 1,000 households (owner, 2026-10-17).
  households: integer('households'),
  // The search kill switch (owner, 2026-10-17): a live town hidden from search keeps serving
  // readers but is noindex everywhere and lists nothing in its sitemaps, until staff show it again.
  searchHidden: boolean('search_hidden').notNull().default(false),
  // Automated follow-ups to business owners (trial ending, a competitor's spot, a story, a nearby
  // claim) send by themselves only while an admin's standing approval is on (Rule 10, owner
  // 2026-10-17); otherwise they wait as drafts for staff to press Send.
  businessMailApprovedAt: timestamp('business_mail_approved_at', { withTimezone: true }),
  businessMailApprovedBy: uuid('business_mail_approved_by'),
  // Launch cohort, the month a town went live ("2027-01"): towns roll out, and can be hidden from
  // search, a cohort at a time.
  cohort: text('cohort'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Towns ranked by `pnpm towns:rank` (CLAUDE.md §10a; docs/plans/M7.md §1). A launch starts only
// from an approved row; re-ranking updates scores and inputs but never a staff decision.
export const townCandidates = pgTable(
  'town_candidates',
  {
    id: id(),
    state: text('state').notNull(),
    /** Census place GEOID (state FIPS + place code), the town's future `census_id`. */
    geoid: text('geoid').notNull(),
    /** "Delray Beach" (the Census name without its "city"/"town" suffix). */
    name: text('name').notNull(),
    /** Raw figures and normalized inputs, with their sources and vintages. */
    inputs: jsonb('inputs').notNull(),
    score: real('score').notNull(),
    rank: integer('rank').notNull(),
    status: text('status')
      .$type<'proposed' | 'approved' | 'rejected' | 'live'>()
      .notNull()
      .default('proposed'),
    rankedAt: timestamp('ranked_at', { withTimezone: true }).notNull(),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('town_candidates_geoid_uq').on(t.geoid),
    index('town_candidates_state_rank_idx').on(t.state, t.rank),
    check(
      'town_candidates_status',
      sql`${t.status} in ('proposed', 'approved', 'rejected', 'live')`,
    ),
  ],
);

// A run of `pnpm launch` (docs/plans/M7.md §2). Dry run unless the operator asked for an approved
// spend; one record per step so a stopped run resumes. Only from an approved candidate (§10).
export const launches = pgTable(
  'launches',
  {
    id: id(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => townCandidates.id),
    geoid: text('geoid').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    state: text('state').notNull(),
    status: text('status')
      .$type<'running' | 'stopped' | 'failed' | 'ready' | 'approved'>()
      .notNull()
      .default('running'),
    dryRun: boolean('dry_run').notNull().default(true),
    /** What the operator passed (e.g. --domain), kept for resumes and the report. */
    options: jsonb('options').notNull().default({}),
    /** The operator's machine user, for the record; staff identity comes with go-live. */
    startedBy: text('started_by'),
    stoppedReason: text('stopped_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('launches_geoid_idx').on(t.geoid),
    check(
      'launches_status',
      sql`${t.status} in ('running', 'stopped', 'failed', 'ready', 'approved')`,
    ),
  ],
);

export const launchStepRecords = pgTable(
  'launch_steps',
  {
    id: id(),
    launchId: uuid('launch_id')
      .notNull()
      .references(() => launches.id, { onDelete: 'cascade' }),
    step: text('step').notNull(),
    status: text('status')
      .$type<'pending' | 'done' | 'failed' | 'skipped'>()
      .notNull()
      .default('pending'),
    /** What the step found (resolved town facts, name checks, sources …). */
    detail: jsonb('detail'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('launch_steps_launch_step_uq').on(t.launchId, t.step),
    check('launch_steps_status', sql`${t.status} in ('pending', 'done', 'failed', 'skipped')`),
  ],
);

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
    // When its entities were extracted (M4 PR D); null until the entities job has run on it.
    entitiesExtractedAt: timestamp('entities_extracted_at', { withTimezone: true }),
    // Guides only (M4 PR F): the guide topic. One guide per topic per town, rewritten in place
    // when its pages change.
    guideTopic: text('guide_topic'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('articles_town_slug_uq').on(t.townId, t.slug),
    uniqueIndex('articles_town_guide_topic_uq')
      .on(t.townId, t.guideTopic)
      .where(sql`${t.guideTopic} is not null`),
    index('articles_town_status_published_idx').on(t.townId, t.status, t.publishedAt.desc()),
    check('articles_tier_range', sql`${t.tier} between 1 and 4`),
    // Rule 5: Tier 4 is never public.
    check(
      'articles_tier4_never_public',
      sql`${t.tier} < 4 or ${t.status} in ('blocked', 'rejected')`,
    ),
    // Rule 2: the newsroom byline on anything public.
    check(
      'articles_public_byline',
      sql`${t.status} not in ('published', 'corrected') or ${t.byline} like '% Newsroom%'`,
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

// The tropics panel (packages/config/src/tropics.ts): the National Hurricane Center's latest
// storms and outlook per basin, shared by every town and refreshed hourly by the worker.
export const tropics = pgTable('tropics', {
  basin: text('basin').$type<TropicsBasin>().primaryKey(),
  snapshot: jsonb('snapshot').$type<TropicsSnapshot>(),
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
    /** The owner stopped follow-ups and monthly reports (the unsubscribe link in them). */
    ownerMailOptOutAt: timestamp('owner_mail_opt_out_at', { withTimezone: true }),
    // Owner-edited fields (M6 PR C). A new name waits in pending_name for staff review.
    description: text('description'),
    hours: text('hours'),
    serviceArea: text('service_area'),
    pendingName: text('pending_name'),
    ownerUpdatedAt: timestamp('owner_updated_at', { withTimezone: true }),
    // OpenStreetMap (owner, 2026-10-16): the mapped place this listing comes from or was matched
    // to ("node/123"), its cuisine, and whether its street address may be shown before a claim.
    // A mapped storefront's address is public; a license address can be a home (D-M6-2).
    osmRef: text('osm_ref'),
    cuisine: text('cuisine'),
    addressPublic: boolean('address_public').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('businesses_town_category_idx').on(t.townId, t.category),
    uniqueIndex('businesses_town_slug_uq').on(t.townId, t.slug),
    uniqueIndex('businesses_town_osm_uq').on(t.townId, t.osmRef),
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

// "Add your business" (owner, 2026-10-16): a business that isn't listed asks to be. Nothing is
// listed until staff check it and press Add; the listing then shows the details sent, since the
// sender gave them as the business's public details.
export const businessRequests = pgTable(
  'business_requests',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    name: text('name').notNull(),
    category: text('category').notNull(),
    address: text('address'),
    zip: text('zip'),
    phone: text('phone'),
    website: text('website'),
    contactName: text('contact_name').notNull(),
    email: text('email').notNull(),
    note: text('note'),
    status: text('status').notNull().default('pending'),
    businessId: uuid('business_id').references(() => businesses.id),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('business_requests_town_status_idx').on(t.townId, t.status, t.createdAt),
    index('business_requests_ip_created_idx').on(t.ip, t.createdAt),
    check('business_requests_status', sql`${t.status} in ('pending', 'added', 'rejected')`),
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
    /** A featured spot's rank in its category, 1 (the Top spot) to 3; null for unranked products. */
    rank: smallint('rank'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePriceId: text('stripe_price_id'),
    /** The owner who bought it (their claim's email). */
    buyerEmail: text('buyer_email'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** When the free trial ends and the first charge is due (from Stripe), for the reminder. */
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /**
     * A booked week or month (newsletter, category sponsorship): the first local day, as
     * YYYY-MM-DD. Null for monthly subscriptions.
     */
    period: text('period'),
    status: placementStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('placements_town_product_idx').on(t.townId, t.product, t.category),
    uniqueIndex('placements_checkout_session_uq').on(t.stripeCheckoutSessionId),
    uniqueIndex('placements_subscription_uq').on(t.stripeSubscriptionId),
    check('placements_rank', sql`${t.rank} is null or ${t.rank} between 1 and 3`),
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
    /** The featured spot this price is for (1–3), or null for unranked products. */
    rank: smallint('rank'),
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
    // M6 PR E: the town and slot a lead came from; a quote request routed to several
    // businesses shares one request_id; ip only for rate limits.
    townId: uuid('town_id').references(() => towns.id),
    slot: text('slot'),
    requestId: uuid('request_id'),
    ip: text('ip'),
    meta: jsonb('meta'),
    createdAt: createdAt(),
  },
  (t) => [
    index('leads_business_created_idx').on(t.businessId, t.createdAt),
    index('leads_ip_created_idx').on(t.ip, t.createdAt),
  ],
);

// Monetization slot counts per day (CLAUDE.md §11b): impressions (the unit was on screen),
// clicks and leads, per slot and, where known, campaign and business. Cookieless, like the
// article counters (D-M4-3): no reader identifiers, only counts.
export const slotStatsDaily = pgTable(
  'slot_stats_daily',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    day: date('day').notNull(),
    slot: text('slot').notNull(),
    // Counts belong to their campaign and business: deleting either deletes its counts.
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    leads: integer('leads').notNull().default(0),
  },
  (t) => [
    unique('slot_stats_daily_key_uq')
      .on(t.townId, t.day, t.slot, t.campaignId, t.businessId)
      .nullsNotDistinct(),
    index('slot_stats_daily_business_day_idx').on(t.businessId, t.day),
  ],
);

// Monthly proof reports emailed to paying businesses (D-M6-10): one row per business and month,
// so a report is never sent twice.
export const proofReports = pgTable(
  'proof_reports',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    month: text('month').notNull(),
    email: text('email').notNull(),
    totals: jsonb('totals').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('proof_reports_business_month_uq').on(t.businessId, t.month)],
);

// Outreach drafts (CLAUDE.md §11 "business triggers"; M6 PR F): when a published story names a
// listed business, the system drafts an email to it. Nothing is sent until a staff member
// reviews it and presses Send (Rule 10); sending opens a conversation in the shared inbox.
export const outreachDrafts = pgTable(
  'outreach_drafts',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    /** The claimed owner's address; empty for unclaimed listings until staff add one. */
    toEmail: text('to_email'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').$type<'draft' | 'sent' | 'dismissed'>().notNull().default('draft'),
    threadId: uuid('thread_id').references(() => threads.id),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('outreach_drafts_business_article_uq').on(t.businessId, t.articleId),
    index('outreach_drafts_status_idx').on(t.status),
    check('outreach_drafts_status', sql`${t.status} in ('draft', 'sent', 'dismissed')`),
  ],
);

// Follow-ups to business owners (owner, 2026-10-17): the trial is ending, a competitor took a
// featured spot in their category, a story named the business, or a business nearby in their
// category was claimed. Built as drafts; the sender mails one by itself only while the town's
// standing approval is on (towns.business_mail_approved_at), else staff press Send (Rule 10).
// One row per event (dedupe_key), so a retry never mails twice.
export const businessFollowups = pgTable(
  'business_followups',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: text('kind')
      .$type<
        'trial_ending' | 'competitor_spot' | 'story_mention' | 'nearby_claim' | 'waitlist_open'
      >()
      .notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    lines: jsonb('lines').$type<string[]>().notNull(),
    linkHref: text('link_href').notNull(),
    linkLabel: text('link_label').notNull(),
    status: text('status').$type<'draft' | 'sent' | 'skipped'>().notNull().default('draft'),
    /** Why it wasn't sent: suppressed, unsubscribed, stale, or a staff member's choice. */
    note: text('note'),
    sentBy: uuid('sent_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('business_followups_dedupe_uq').on(t.dedupeKey),
    index('business_followups_status_idx').on(t.status, t.townId),
    index('business_followups_business_idx').on(t.businessId, t.decidedAt),
    check(
      'business_followups_kind',
      sql`${t.kind} in ('trial_ending', 'competitor_spot', 'story_mention', 'nearby_claim', 'waitlist_open')`,
    ),
    check('business_followups_status', sql`${t.status} in ('draft', 'sent', 'skipped')`),
  ],
);

// Directory prices (owner, 2026-10-17): the current price of a category product in a town, one
// for everyone. No row means the town's list price (its tier's, or its YAML's). Changed only by
// the monthly recalculation inside its guardrails, an approved proposal, or an admin override;
// existing subscriptions keep the Stripe Price they were sold at (grandfathered).
export const directoryPrices = pgTable(
  'directory_prices',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    category: text('category').notNull(),
    product: placementProduct('product').notNull(),
    /** The featured spot (1–3), or null for an unranked product. */
    rank: smallint('rank'),
    amountCents: integer('amount_cents').notNull(),
    setBy: text('set_by').$type<'monthly' | 'approved' | 'override'>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('directory_prices_key_uq')
      .on(t.townId, t.category, t.product, t.rank)
      .nullsNotDistinct(),
    check('directory_prices_amount', sql`${t.amountCents} >= 100`),
    check('directory_prices_rank', sql`${t.rank} is null or ${t.rank} between 1 and 3`),
  ],
);

// Every price change and proposal, with the aggregate inputs that produced it (fill rate,
// waitlist, delivered value, interest). `monthly` rows are one per key and month; a `proposed`
// one waits for an admin in Admin → Directory → Pricing. Overrides are logged here and audited.
export const priceChanges = pgTable(
  'price_changes',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    category: text('category').notNull(),
    product: placementProduct('product').notNull(),
    rank: smallint('rank'),
    /** The month the recalculation ran for (YYYY-MM). */
    month: text('month').notNull(),
    kind: text('kind').$type<'monthly' | 'override'>().notNull(),
    oldCents: integer('old_cents').notNull(),
    newCents: integer('new_cents').notNull(),
    status: text('status')
      .$type<'applied' | 'proposed' | 'approved' | 'rejected' | 'expired'>()
      .notNull(),
    reason: text('reason').notNull(),
    inputs: jsonb('inputs').notNull(),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('price_changes_monthly_uq')
      .on(t.townId, t.category, t.product, sql`coalesce(${t.rank}, 0)`, t.month)
      .where(sql`${t.kind} = 'monthly'`),
    index('price_changes_town_created_idx').on(t.townId, t.createdAt),
    index('price_changes_status_idx').on(t.status),
    check('price_changes_kind', sql`${t.kind} in ('monthly', 'override')`),
    check(
      'price_changes_status',
      sql`${t.status} in ('applied', 'proposed', 'approved', 'rejected', 'expired')`,
    ),
  ],
);

// One recalculation per town and month, so a re-run never moves a price twice.
export const pricingRuns = pgTable(
  'pricing_runs',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    month: text('month').notNull(),
    variant: text('variant').notNull(),
    evaluated: integer('evaluated').notNull().default(0),
    changed: integer('changed').notNull().default(0),
    proposed: integer('proposed').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pricing_runs_town_month_uq').on(t.townId, t.month)],
);

// Featured-spot waitlist (owner, 2026-10-17): when every spot in a category is sold, a business
// can ask to hear when one opens. Joined with consent (the form's checkbox, or the owner's own
// button). When a spot frees up, waiting entries tied to a claimed listing get a `waitlist_open`
// follow-up through the usual drafts and standing approval (Rule 10); the count feeds pricing.
export const directoryWaitlist = pgTable(
  'directory_waitlist',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    category: text('category').notNull(),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    /** Where they joined: the category page, the advertise page or the owner page. */
    source: text('source').$type<'category' | 'advertise' | 'owner'>().notNull(),
    status: text('status').$type<'waiting' | 'notified' | 'removed'>().notNull().default('waiting'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    /** For the rate limit only. */
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('directory_waitlist_waiting_uq')
      .on(t.townId, t.category, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'waiting'`),
    index('directory_waitlist_ip_idx').on(t.ip, t.createdAt),
    check('directory_waitlist_status', sql`${t.status} in ('waiting', 'notified', 'removed')`),
    check('directory_waitlist_source', sql`${t.source} in ('category', 'advertise', 'owner')`),
  ],
);

// Owner testimonials (owner, 2026-10-17): written by an owner who advertised, with explicit
// permission to show it, and shown on /advertise only after staff approve it (audited).
export const businessTestimonials = pgTable(
  'business_testimonials',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    quote: text('quote').notNull(),
    /** How it's credited on the page: the business name. */
    attribution: text('attribution').notNull(),
    permissionAt: timestamp('permission_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected'>()
      .notNull()
      .default('pending'),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('business_testimonials_town_status_idx').on(t.townId, t.status),
    check('business_testimonials_status', sql`${t.status} in ('pending', 'approved', 'rejected')`),
  ],
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
    // Prompt-cache writes, billed at 1.25x input (owner, 2026-10-17: log cache hits).
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    estCostUsd: numeric('est_cost_usd', { precision: 10, scale: 6 }).notNull(),
    provider: text('provider'),
    promptVersion: text('prompt_version'),
    // ok | refused | invalid (output failed its schema) | error (no usable response)
    outcome: text('outcome').notNull().default('ok'),
    // The routing table's task (packages/config/src/models.ts); null on rows from before it.
    task: text('task'),
    // A retry on a bigger model after low confidence or invalid output.
    escalated: boolean('escalated').notNull().default(false),
    // Served through the Message Batches API (half price).
    batch: boolean('batch').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_usage_town_created_idx').on(t.townId, t.createdAt),
    index('ai_usage_task_created_idx').on(t.task, t.createdAt),
  ],
);

// Model requests by idempotency key (owner, 2026-10-17: "never resend a call that already
// succeeded"). A successful answer is kept, so the same request (same task, prompt and input)
// returns it without a model call; batched requests wait here until the worker submits them
// and collects their answers.
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: id(),
    key: text('key').notNull(),
    townId: uuid('town_id').references(() => towns.id),
    task: text('task').notNull(),
    job: text('job').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    // queued (batch, not sent) | submitted (in a batch) | succeeded | failed
    status: text('status').notNull(),
    batchId: text('batch_id'),
    /** The provider request, kept for batch submission. */
    request: jsonb('request'),
    /** The provider response once answered. */
    response: jsonb('response'),
    error: text('error'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ai_requests_key_idx').on(t.key),
    index('ai_requests_status_idx').on(t.status, t.createdAt),
    check('ai_requests_status', sql`${t.status} in ('queued', 'submitted', 'succeeded', 'failed')`),
  ],
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

/**
 * Article visuals (CLAUDE.md §11c). One lead visual per article, chosen by the image router.
 * Every row records what it is, where it came from, its license and whether it is AI-generated;
 * generated cards and graphics are our own work. `spec` holds what's needed to draw it (a data
 * graphic's numbers, built from the article's own records).
 */
export const images = pgTable(
  'images',
  {
    id: id(),
    // An image belongs to its article and goes with it.
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ImageKind>().notNull(),
    spec: jsonb('spec').$type<ImageSpec>().notNull(),
    /** Written from what the image actually shows. */
    alt: text('alt').notNull(),
    sourceUrl: text('source_url'),
    license: text('license').notNull(),
    attribution: text('attribution'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    approvedBy: uuid('approved_by').references(() => staff.id),
    // When the router last ran with its network options, maps and stock photos (null: not since
    // the article was last re-assigned; the worker's visuals jobs pick it up).
    mapCheckedAt: timestamp('map_checked_at', { withTimezone: true }),
    // A chart is never a cover: the library illustration that covers this story in lists and on
    // the homepage, recorded so the no-repeat rule sees it (docs/plans/default-images.md).
    coverIllustrationId: text('cover_illustration_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('images_article_uq').on(t.articleId),
    check(
      'images_kind',
      sql`${t.kind} in (${sql.raw(imageKinds.map((k) => `'${k}'`).join(', '))})`,
    ),
    // AI images must be labeled as such and approved by a person (§11c).
    check('images_ai_approved', sql`not ${t.aiGenerated} or ${t.approvedBy} is not null`),
  ],
);
export type Image = typeof images.$inferSelect;

/**
 * Named things our stories mention (CLAUDE.md §6a; docs/plans/M4.md §4): businesses, streets,
 * neighborhoods, schools, public officials, projects, agencies. One row per town, kind and
 * normalized key; each has a topic page at /topics/<slug>.
 */
export const entities = pgTable(
  'entities',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    kind: text('kind').$type<EntityKind>().notNull(),
    /** As first written in one of our stories. */
    name: text('name').notNull(),
    /** entityKey(kind, name): how mentions are matched. */
    key: text('key').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('entities_town_kind_key_uq').on(t.townId, t.kind, t.key),
    uniqueIndex('entities_town_slug_uq').on(t.townId, t.slug),
    check(
      'entities_kind',
      sql`${t.kind} in (${sql.raw(entityKinds.map((k) => `'${k}'`).join(', '))})`,
    ),
  ],
);
export type Entity = typeof entities.$inferSelect;

/** Which stories mention which entities, with the exact words used. */
export const articleEntities = pgTable(
  'article_entities',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    /** The name exactly as it appears in this story (checked in code). */
    mention: text('mention').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.entityId] }),
    index('article_entities_entity_idx').on(t.entityId),
  ],
);

/**
 * Each town's base map (D-M4-1): roads, waterways and coastline clipped from the state's
 * OpenStreetMap extract (Geofabrik) and simplified. Refreshed monthly; maps credit
 * "© OpenStreetMap contributors" (ODbL).
 */
export const townBasemaps = pgTable('town_basemaps', {
  townId: uuid('town_id')
    .primaryKey()
    .references(() => towns.id),
  /** [west, south, east, north] in degrees. */
  bbox: jsonb('bbox').$type<[number, number, number, number]>().notNull(),
  /** [{ c: class, n?: name, p: [[lon, lat], …] }] */
  lines: jsonb('lines')
    .$type<Array<{ c: string; n?: string; p: Array<[number, number]> }>>()
    .notNull(),
  sourceUrl: text('source_url').notNull(),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull(),
});

/**
 * Photos people send us (M9, CLAUDE.md §11c): readers and contributors through a town site's
 * form, business owners through the owner portal. Each is re-encoded with its metadata (GPS
 * included) stripped before it's stored, carries the license grant its sender accepted, and is
 * shown only after staff approve it with alt text written from what it shows. AI illustrations
 * for guides wait here too (kind `illustration`, for one article), so a person approves every
 * AI image before it appears.
 */
export const photoSubmissions = pgTable(
  'photo_submissions',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    /** Set for a business owner's photo of their listing. */
    businessId: uuid('business_id').references(() => businesses.id),
    /** Set for an AI illustration: the guide it was made for. */
    articleId: uuid('article_id').references(() => articles.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'reader' | 'business' | 'illustration'>().notNull(),
    /** Where the re-encoded JPEG is kept (storage key, never a public URL). */
    storageKey: text('storage_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    caption: text('caption').notNull(),
    /** Where and when it was taken, as the sender wrote it. */
    takenWhere: text('taken_where'),
    takenWhen: text('taken_when'),
    /** Shown under the photo: "Photo: Pat Reader". */
    credit: text('credit').notNull(),
    /** Never shown. */
    submitterName: text('submitter_name').notNull(),
    submitterEmail: text('submitter_email').notNull(),
    licenseVersion: text('license_version').notNull(),
    licenseText: text('license_text').notNull(),
    consentIp: text('consent_ip'),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected'>()
      .notNull()
      .default('pending'),
    /** Written by the reviewer from what the photo shows; required to approve. */
    alt: text('alt'),
    reviewedBy: uuid('reviewed_by').references(() => staff.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    /** The last time a story used it (the router doesn't reuse a photo within a week). */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('photo_submissions_town_status_idx').on(t.townId, t.status, t.createdAt.desc()),
    check('photo_submissions_kind', sql`${t.kind} in ('reader', 'business', 'illustration')`),
    check('photo_submissions_status', sql`${t.status} in ('pending', 'approved', 'rejected')`),
    check(
      'photo_submissions_business',
      sql`(${t.kind} = 'business') = (${t.businessId} is not null)`,
    ),
    check(
      'photo_submissions_illustration',
      sql`(${t.kind} = 'illustration') = (${t.articleId} is not null)`,
    ),
    // Approved photos have reviewer-written alt text and a reviewer (§11c).
    check(
      'photo_submissions_approved',
      sql`${t.status} <> 'approved' or (${t.alt} is not null and ${t.reviewedBy} is not null)`,
    ),
  ],
);

// Scores readers send in (owner, 2026-10-17: "use reader scores meanwhile", while an FHSAA data
// license is asked for). Team level only: structured fields, no free text where a player could
// be named (§7). Nothing shows until staff approve it; approval writes a `game` record.
export const scoreReports = pgTable(
  'score_reports',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    sport: text('sport').notNull(),
    level: text('level').notNull(),
    home: text('home').notNull(),
    away: text('away').notNull(),
    homeScore: integer('home_score').notNull(),
    awayScore: integer('away_score').notNull(),
    playedOn: date('played_on').notNull(),
    venue: text('venue'),
    /** Which teams are the town's: 'home', 'away' or 'both'. */
    localSide: text('local_side').$type<'home' | 'away' | 'both'>().notNull(),
    /** Never shown. */
    reporterName: text('reporter_name').notNull(),
    reporterEmail: text('reporter_email').notNull(),
    consentIp: text('consent_ip'),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected'>()
      .notNull()
      .default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => staff.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    /** The game record an approval wrote. */
    recordId: uuid('record_id').references(() => records.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('score_reports_town_status_idx').on(t.townId, t.status, t.createdAt.desc()),
    check('score_reports_status', sql`${t.status} in ('pending', 'approved', 'rejected')`),
    check('score_reports_side', sql`${t.localSide} in ('home', 'away', 'both')`),
    check('score_reports_scores', sql`${t.homeScore} >= 0 and ${t.awayScore} >= 0`),
    check(
      'score_reports_approved',
      sql`${t.status} <> 'approved' or (${t.reviewedBy} is not null and ${t.recordId} is not null)`,
    ),
  ],
);

// A town's logo art (owner, 2026-10-17): made in ChatGPT from the prompt the launcher writes,
// imported by a person, and cut in code into the hero, icons and share images. Recorded like
// `images` (§11c): AI-generated, its source and license, and the person who approved it. It
// belongs to a town, not an article (`images` rows are one per article), so it has its own table;
// the latest row is the town's current art.
export const identityArt = pgTable(
  'identity_art',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    /** Who made it ("ChatGPT, by the owner"). */
    source: text('source').notNull(),
    license: text('license').notNull(),
    /** The imported file's name and SHA-256, so the exact original can be identified. */
    fileName: text('file_name').notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Where the derived files are served from (the town's `app_icon`). */
    assetDir: text('asset_dir').notNull(),
    aiGenerated: boolean('ai_generated').notNull().default(true),
    approvedBy: uuid('approved_by')
      .notNull()
      .references(() => staff.id),
    createdAt: createdAt(),
  },
  (t) => [index('identity_art_town_idx').on(t.townId, t.createdAt)],
);
export type IdentityArt = typeof identityArt.$inferSelect;

// Where article views came from, by class only (owner, 2026-10-17: Facebook referrals, search,
// newsletter). The class is worked out in the reader's browser; the referrer URL is never sent.
// Cookieless: no identifiers, only per-town daily counts (D-M4-3).
export const referralStatsDaily = pgTable(
  'referral_stats_daily',
  {
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    day: date('day').notNull(),
    source: text('source').notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.townId, t.day, t.source] })],
);

// Experiments (§11a-2, owner 2026-10-17): the variants live in code (packages/config audience.ts);
// this records which experiments run, by town or cohort, and the winner once decided, which then
// shows in every town. Assignment is by a hash of the town or cohort: never per reader.
export const experiments = pgTable(
  'experiments',
  {
    key: text('key').primaryKey(),
    status: text('status').$type<'off' | 'running' | 'decided'>().notNull().default('off'),
    unit: text('unit').$type<'town' | 'cohort'>().notNull().default('town'),
    winner: text('winner'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    updatedBy: uuid('updated_by').references(() => staff.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('experiments_status', sql`${t.status} in ('off', 'running', 'decided')`),
    check('experiments_unit', sql`${t.unit} in ('town', 'cohort')`),
    check('experiments_winner', sql`${t.status} <> 'decided' or ${t.winner} is not null`),
  ],
);

/** The variant each town got when an experiment started (or when it first showed after). */
export const experimentAssignments = pgTable(
  'experiment_assignments',
  {
    experimentKey: text('experiment_key')
      .notNull()
      .references(() => experiments.key, { onDelete: 'cascade' }),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    variant: text('variant').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.experimentKey, t.townId] })],
);

// The Facebook post queue (owner, 2026-10-17): each town's best 1–3 published items a day and
// its weekly shareable roundups, with factual post text written from the story. Staff post the
// day's batch in one pass from Admin → Facebook, by hand or through the Graph API when they press
// Post; nothing is posted automatically without the owner's standing approval (FACEBOOK_AUTOPOST).
export const facebookPosts = pgTable(
  'facebook_posts',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    /** 'daily': one of the day's best items; 'weekly': a shareable roundup. */
    kind: text('kind').$type<'daily' | 'weekly'>().notNull(),
    /** The town's local date the post is queued for. */
    day: date('day').notNull(),
    message: text('message').notNull(),
    link: text('link').notNull(),
    status: text('status').$type<'queued' | 'posted' | 'skipped'>().notNull().default('queued'),
    /** How it went out: copied by staff, or posted through the Graph API. */
    method: text('method').$type<'manual' | 'graph'>(),
    /** The Graph API's post id, when posted through it. */
    externalId: text('external_id'),
    postedBy: uuid('posted_by').references(() => staff.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('facebook_posts_town_article_uq').on(t.townId, t.articleId),
    index('facebook_posts_day_status_idx').on(t.day, t.status),
    check('facebook_posts_kind', sql`${t.kind} in ('daily', 'weekly')`),
    check('facebook_posts_status', sql`${t.status} in ('queued', 'posted', 'skipped')`),
    check(
      'facebook_posts_posted',
      sql`${t.status} <> 'posted' or (${t.postedAt} is not null and ${t.method} is not null)`,
    ),
  ],
);

// Quick polls (owner, 2026-10-17, reader participation): an opinion question about a local topic,
// never about a named private person, with 2–4 options. Staff write it and a staff member approves
// it before it shows; readers vote once, counted by a salted hash of their address (never stored
// raw).
export const polls = pgTable(
  'polls',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    question: text('question').notNull(),
    options: text('options').array().notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').$type<'draft' | 'approved' | 'withdrawn'>().notNull().default('draft'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staff.id),
    approvedBy: uuid('approved_by').references(() => staff.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('polls_town_status_idx').on(t.townId, t.status, t.startsAt),
    check('polls_status', sql`${t.status} in ('draft', 'approved', 'withdrawn')`),
    check('polls_options', sql`cardinality(${t.options}) between 2 and 4`),
    check('polls_window', sql`${t.endsAt} > ${t.startsAt}`),
    check('polls_approved', sql`${t.status} <> 'approved' or ${t.approvedBy} is not null`),
  ],
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    id: id(),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    option: smallint('option').notNull(),
    /** A salted hash of the voter's address and the poll: one vote per address per poll. */
    voterHash: text('voter_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('poll_votes_poll_voter_uq').on(t.pollId, t.voterHash),
    check('poll_votes_option', sql`${t.option} between 0 and 3`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Agentic operations (owner, 2026-10-17, "Connected systems and agentic workflows";
// docs/plans/agentic-ops.md). Agents do the work and prepare each decision; people approve with
// one click. Every table here records state, so a crashed run resumes where it stopped.

// A launch cohort: approved towns launched together (docs/plans/rollout.md). The domains are
// bought in ONE admin approval of the cohort's stated total (Rule 10); the cohort goes live in
// one more. Dry run unless the admin created it to spend.
export const launchCohorts = pgTable(
  'launch_cohorts',
  {
    id: id(),
    name: text('name').notNull().unique(),
    status: text('status')
      .$type<
        'preparing' | 'awaiting_purchase' | 'running' | 'awaiting_go_live' | 'live' | 'cancelled'
      >()
      .notNull()
      .default('preparing'),
    dryRun: boolean('dry_run').notNull().default(true),
    /**
     * The admin's batch approval: who, when, the total typed back, and each town's domain at its
     * stated price. Purchases and the mail onboarding that follows run only under it.
     */
    purchaseApproval: jsonb('purchase_approval'),
    goLiveApproval: jsonb('go_live_approval'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staff.id),
    /** One orchestrator run at a time per cohort. */
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'launch_cohorts_status',
      sql`${t.status} in ('preparing', 'awaiting_purchase', 'running', 'awaiting_go_live', 'live', 'cancelled')`,
    ),
  ],
);

// One town in a cohort and where it is in the chain: names → purchase → mail → dns → provision →
// review → live. `todos` are the manual steps, batched across the cohort for one pass.
export const launchCohortTowns = pgTable(
  'launch_cohort_towns',
  {
    id: id(),
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => launchCohorts.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => townCandidates.id),
    launchId: uuid('launch_id').references(() => launches.id),
    stage: text('stage')
      .$type<'names' | 'purchase' | 'mail' | 'dns' | 'provision' | 'review' | 'live'>()
      .notNull()
      .default('names'),
    state: text('state')
      .$type<'pending' | 'running' | 'waiting' | 'done' | 'failed'>()
      .notNull()
      .default('pending'),
    /** The clear name proposal (1–3) the admin picked; the first by default. */
    pick: smallint('pick').notNull().default(1),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    todos: jsonb('todos')
      .$type<Array<{ key: string; text: string; done: boolean }>>()
      .notNull()
      .default([]),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('launch_cohort_towns_uq').on(t.cohortId, t.candidateId),
    check(
      'launch_cohort_towns_stage',
      sql`${t.stage} in ('names', 'purchase', 'mail', 'dns', 'provision', 'review', 'live')`,
    ),
    check(
      'launch_cohort_towns_state',
      sql`${t.state} in ('pending', 'running', 'waiting', 'done', 'failed')`,
    ),
    check('launch_cohort_towns_pick', sql`${t.pick} between 1 and 3`),
  ],
);

// The standing source-discovery agent's findings (weekly, towns furthest below the Rule 7 target
// first). Every URL was verified in code; a proposal becomes a source only when staff approve it,
// and `pnpm sources:export` then writes approved ones into the town YAML for a pull request.
export const sourceProposals = pgTable(
  'source_proposals',
  {
    id: id(),
    townId: uuid('town_id')
      .notNull()
      .references(() => towns.id),
    /** `source`: a known platform, ready to add. `adapter`: an unknown platform to build. */
    type: text('type').$type<'source' | 'adapter'>().notNull(),
    /** The town YAML's source key for `source`; `adapter:<kind>:<url>` otherwise. */
    key: text('key').notNull(),
    kind: sourceKind('kind').notNull(),
    url: text('url').notNull(),
    platform: text('platform'),
    /** The source config to add (TownSourceConfig), for `source` proposals. */
    config: jsonb('config'),
    label: text('label').notNull(),
    /** Who suggested it, and what code found when it fetched the URL. */
    origin: text('origin').notNull(),
    detail: text('detail').notNull(),
    /** Estimated real items a day it would add, and how that was estimated. */
    estimatePerDay: real('estimate_per_day'),
    estimateBasis: text('estimate_basis').notNull(),
    status: text('status')
      .$type<'proposed' | 'approved' | 'rejected'>()
      .notNull()
      .default('proposed'),
    sourceId: uuid('source_id').references(() => sources.id),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** When `pnpm sources:export` wrote it into the town YAML. */
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('source_proposals_town_key_uq').on(t.townId, t.key),
    index('source_proposals_status_idx').on(t.status, t.createdAt),
    check('source_proposals_type', sql`${t.type} in ('source', 'adapter')`),
    check('source_proposals_status', sql`${t.status} in ('proposed', 'approved', 'rejected')`),
  ],
);

export const fixFailures = [
  'robots',
  'blocked',
  'http_auth',
  'http_gone',
  'http_server',
  'rate_limited',
  'timeout',
  'network',
  'parse',
  'empty',
  'unknown',
] as const;
export type FixFailure = (typeof fixFailures)[number];

// Self-healing adapters: a broken source gets a fresh fixture of its failing fetch, a diagnosis
// in code and a fix request. Fixes are written in a Claude Code session
// (docs/ops/adapter-fix-routine.md), never by the pipeline. The same failure on one platform in
// several towns becomes one platform request (`scope: platform`) the town requests point to.
export const adapterFixRequests = pgTable(
  'adapter_fix_requests',
  {
    id: id(),
    scope: text('scope').$type<'source' | 'platform'>().notNull(),
    sourceId: uuid('source_id').references(() => sources.id),
    townId: uuid('town_id').references(() => towns.id),
    platform: text('platform').notNull(),
    failure: text('failure').$type<FixFailure>().notNull(),
    httpStatus: integer('http_status'),
    error: text('error').notNull(),
    diagnosis: text('diagnosis').notNull(),
    /** The recorded exchanges of the failing fetch (packages/adapters/src/http/fixtures.ts). */
    fixture: jsonb('fixture'),
    platformRequestId: uuid('platform_request_id'),
    status: text('status')
      .$type<'open' | 'in_progress' | 'fixed' | 'dismissed'>()
      .notNull()
      .default('open'),
    prUrl: text('pr_url'),
    note: text('note'),
    resolvedBy: uuid('resolved_by').references(() => staff.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('adapter_fix_requests_open_source_uq')
      .on(t.sourceId)
      .where(sql`${t.scope} = 'source' and ${t.status} in ('open', 'in_progress')`),
    uniqueIndex('adapter_fix_requests_open_platform_uq')
      .on(t.platform, t.failure)
      .where(sql`${t.scope} = 'platform' and ${t.status} in ('open', 'in_progress')`),
    check('adapter_fix_requests_scope', sql`${t.scope} in ('source', 'platform')`),
    check(
      'adapter_fix_requests_status',
      sql`${t.status} in ('open', 'in_progress', 'fixed', 'dismissed')`,
    ),
    check(
      'adapter_fix_requests_source',
      sql`(${t.scope} = 'source') = (${t.sourceId} is not null)`,
    ),
  ],
);

// The ops agent's daily digest, built in code (no model): one row per UTC date.
export const opsDigests = pgTable('ops_digests', {
  id: id(),
  date: date('date').notNull().unique(),
  /** Sections of items, each with a suggested action and an admin link. */
  items: jsonb('items').notNull(),
  text: text('text').notNull(),
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// One inbox of decisions the learning loops prepare (Admin → Proposals): experiment winners,
// model-routing changes from evals, cohort gates, and later pricing. Approve or reject in one
// click, audited; approval runs the proposal's action, or records the decision when the change
// is code (a routing change ships as a pull request).
export const proposals = pgTable(
  'proposals',
  {
    id: id(),
    kind: text('kind').$type<'experiment' | 'routing' | 'cohort_gate' | 'pricing'>().notNull(),
    /** Dedupe key: one open proposal per subject. */
    key: text('key').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status')
      .$type<'open' | 'approved' | 'rejected' | 'superseded'>()
      .notNull()
      .default('open'),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('proposals_open_key_uq')
      .on(t.key)
      .where(sql`${t.status} = 'open'`),
    index('proposals_status_idx').on(t.status, t.createdAt),
    check('proposals_kind', sql`${t.kind} in ('experiment', 'routing', 'cohort_gate', 'pricing')`),
    check('proposals_status', sql`${t.status} in ('open', 'approved', 'rejected', 'superseded')`),
  ],
);

// Each agent run, for Admin and the digest: what ran, for which town, and what it found.
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    agent: text('agent')
      .$type<'source-discovery' | 'adapter-fixes' | 'digest' | 'learning' | 'cohorts'>()
      .notNull(),
    townId: uuid('town_id').references(() => towns.id),
    status: text('status').$type<'ok' | 'failed' | 'skipped'>().notNull(),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('agent_runs_agent_idx').on(t.agent, t.townId, t.startedAt)],
);
