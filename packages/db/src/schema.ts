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
  primaryKey,
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
    // A running onboarding holds this lease so two runs never work on one domain at once.
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('mail_domains_name_lower', sql`${t.name} = lower(${t.name})`),
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
