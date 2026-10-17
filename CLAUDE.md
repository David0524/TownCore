# CLAUDE.md — TownCore

Read this whole file before doing anything. It is the source of truth for what we are building, the rules that cannot be broken, and the order of work. Update the **Status** section at the bottom at the end of every milestone.

---

## 1. What we are building

TownCore runs a network of AI-written local news sites, one per town, each with its own local brand (first site: **Boca Town Square**, BocaTownSquare.com). Each site has:

- A news site written from **primary public sources** (council agendas and meeting video, permits, property sales, business filings, inspections, official police/fire releases, weather, events).
- A **free daily email newsletter** (the core retention product).
- A **local business directory** that sells labeled sponsored slots, leads and newsletter sponsorships.

The long-term goal is thousands of towns. The core system goal: **launching a new town = buy a domain + run one command**, with about 15 minutes of human review.

TownCore is the corporate name and the publisher of every site. Each site looks and reads as an independent local paper: no network branding, badge or cross-site links. Each site's About and Privacy pages name TownCore as the publisher (see rules).

---

## 2. Non-negotiable rules

These protect us from Google spam actions, lawsuits and press exposés. Code must enforce them; do not rely on prompts alone.

1. **Disclose the publisher.** Every site's About page and Privacy page state "{Site Name} is published by TownCore." No other page shows TownCore branding, a network badge or links between sites. Every site has an About page, a Methods page (how AI writes and how stories are checked), and a Corrections page. The Methods page always explains how AI drafts and how stories are checked.
2. **Bylines.** Byline format: `{Site Name} Newsroom` (owner, 2026-10-16: no AI label in bylines; the Methods page explains how stories are made). If a human reviewed or edited it, add `Reviewed by an editor`. Who reviewed it is recorded (`reviewer_id`, audit log), not printed.
3. **Primary sources only.** Stories are written from source documents and records. Never rewrite another news outlet's article. Other outlets may appear only as: headline + one-line summary in our own words + link out.
4. **Every claim is sourced.** Every published article stores and displays links to the source records it was written from.
5. **Risk tiers gate publishing** (Section 7). Tier 3 never auto-publishes. Tier 4 is blocked in code.
6. **Paid placement is always labeled "Sponsored."** Organic directory order is never affected by payment.
7. **Story target, never padding** (owner, 2026-10-17). Every town aims for 3 real items a day (10 for `large`), and Claude keeps finding sources until it gets there; the target is a goal to work toward, not a launch gate. A town short of it still launches; the launch report shows the gap as a source to-do list, and go-live needs readiness measured, not met. The quality floor never relaxes: never pad to hit the number (no filler, thin rewrites or duplicate templates; a missing story beats a thin one), and every story still needs primary sources, the fact-check and the tier rules.
8. **Scraping etiquette.** Respect robots.txt and site terms. Max 1 request/second per host. User-Agent: `TownCoreBot/1.0 (+https://towncore.net/bot; info@towncore.net)` once the towncore.net/bot page exists; until then `TownCoreBot/1.0 (info@towncore.net)`. A robots.txt disallow means we don't fetch that host or path, even when the content is public. One exception: official APIs whose published terms invite automated access may be called even if their host's robots.txt blocks crawlers; they're listed with their terms URL in `packages/adapters/src/http/policy.ts` (`DOCUMENTED_APIS`), still rate-limited and identified. Never use that list to get around a website's robots.txt. Never scrape Google Maps, Yelp, Facebook, Nextdoor, or paid sports databases.
9. **No images from other sites.** Use our own generated generic images, public-domain government images (with credit), or none.
10. **Money and outbound actions need a human.** Never buy domains, charge cards, send email to real people, or deploy to production without an explicit human approval step. Every such command defaults to `--dry-run`.
11. **Secrets** live in environment variables only. Never commit them. Keep `.env.example` current.

---

## 3. Stack (decided — don't relitigate without asking)

| Layer | Choice |
| --- | --- |
| Language | TypeScript everywhere, pnpm workspaces monorepo |
| Web | Next.js (App Router), one app serving every town by request hostname |
| DB | Postgres + Drizzle ORM; migrations in repo |
| Jobs | pg-boss (Postgres-backed queue + cron), separate worker process |
| Scraping | fetch + cheerio first; Playwright only when a site needs JavaScript |
| Documents | Send PDFs directly to Claude when parsing is hard; otherwise pdf text extraction |
| AI | Anthropic TypeScript SDK. Model routing in Section 8 |
| Email | Amazon SES (v2) for all sending and receiving, behind `packages/mail`; one shared staff inbox for every town domain (`docs/plans/MAIL.md`, brief in `docs/mail/BRIEF.md`) |
| Payments | Stripe (Checkout + Billing + webhooks) |
| DNS | Vercel DNS for every town domain, managed through the Vercel REST API |
| Hosting | Web on Vercel (multi-domain); worker on Railway or Fly. Keep infra choices behind small interfaces |
| Staff auth | Google sign-in limited to the company Workspace domain plus the `staff` allow-list, staff-only admin at `/admin` (magic link in local development only) |
| Tests | Vitest; recorded HTTP fixtures for every adapter |

---

## 4. Repo layout

```
apps/
  web/            # Next.js multi-tenant sites + /admin
  worker/         # pg-boss workers: ingest, story finder, writer, fact-check, newsletter
packages/
  db/             # Drizzle schema, migrations, queries
  adapters/       # Source adapters, one folder per PLATFORM (not per town)
  pipeline/       # story finder, writer, fact-check, tier router
  prompts/        # versioned prompt files + eval sets
  launcher/       # town launcher CLI
  email/          # newsletter build + provider abstraction
  mail/           # SES inbox, replies, bulk sending, suppression, domain onboarding CLI
  infra/          # AWS infrastructure as code (CDK): S3, SNS, SES receipt rule, config sets, IAM
  directory/      # listings, seeding, claim flow, Stripe products
  config/         # town config schema (zod) + loader
towns/            # one YAML config per town, e.g. towns/fl/boca-raton.yaml
docs/plans/       # milestone plans written before coding
```

---

## 5. Data model (starting point)

- `towns` — id, slug, name, state, census_id, county, timezone, domain, site_name, status (`draft|live|paused`), tier (`small|mid|large`), config (jsonb), readiness_score
- `sources` — id, town_id, kind (`agenda|meeting_video|permits|property_sales|business_filings|inspections|police|fire|schools|weather|events|city_news|other_outlet`; `city_news` = the town government's own releases), platform, url, adapter, schedule, health (`ok|degraded|broken`), last_ok_at
- `records` — id, source_id, town_id, external_id, type, title, text, url, occurred_at, raw (jsonb), content_hash; unique(source_id, external_id)
- `story_candidates` — id, town_id, record_ids[], beat, proposed_tier, newsworthiness, status
- `articles` — id, town_id, slug, headline, dek, body_md, beat, tier, status (`draft|in_review|published|rejected|blocked|corrected`), byline, reviewer_id, source_record_ids[], claims (jsonb), factcheck (jsonb), published_at, updated_at
- `corrections` — id, article_id, note, created_at (shown publicly)
- `businesses` — id, town_id, slug, name, category, address (shown only once claimed), city, zip, phone, website, license_type, license_number, license_verified, license_expires_at, data_source, source_record_id, osm_ref, cuisine, address_public, active, lat, lng, in_city_limits, geocode_status, geocoded_at, claimed_by_email, claimed_at
- `placements` — id, business_id, town_id, product (`enhanced|sponsored_slot|exclusive|newsletter|spotlight`), category, rank (featured spot 1–3), stripe_subscription_id, starts_at, ends_at, status
- `leads` — id, business_id, kind (`call|form`), meta, created_at
- `subscribers` — id, town_id, email, status (`pending|active|unsubscribed|bounced|complained`), consent_at, consent_source, consent_ip, confirmed_at, unsubscribed_at, last_engaged_at, source
- `newsletter_issues` — id, town_id, date, article_ids[], sponsor_placement_id, sent_at, stats
- `ai_usage` — id, town_id, job, model, input_tokens, output_tokens, est_cost_usd, created_at
- `staff` — id, email, name, role (`admin|reviewer`), active
- Mail (`docs/plans/MAIL.md`): `teams`, `team_members`, `role_addresses`, `signatures`, `mail_domains` (town_id), `domain_identities`, `dns_records`, `onboarding_runs`/`onboarding_steps`, `contacts`, `threads`, `messages`, `attachments`, `notes`, `email_campaign_templates`, `email_campaigns`, `email_campaign_sends`, `suppressions`, `email_events`, `domain_health_daily`. `admin_actions` is the audit log for all staff actions
- `entities`, `article_entities`, `article_scores`, `pins`, `skipped_candidates` — editorial selection and ranking (Section 6a)
- `images` — id, kind, source_url, license, attribution, ai_generated, approved_by (Section 11c)
- `town_candidates` — id, town, state, inputs (jsonb), score, status (`proposed|approved|rejected|live`) (Section 10a)

---

## 6. Pipeline

`ingest → story finder → writer → fact-check → tier router → publish | review queue → distribute`

1. **Ingest** (per source schedule): adapter fetches new items since last run → upsert `records` (dedupe by external_id + content_hash).
2. **Story finder** (every 30 min per town): groups related records, scores newsworthiness, assigns beat and proposed tier, confirms the record is about THIS town (Section 7, wrong-town check). Weather, events and evergreen guides are templated jobs, not candidates.
3. **Writer**: drafts from the source text only. Output JSON: `{headline, dek, body_md, beat, source_record_ids, claims[]}`. Plain, factual, local-newspaper tone. No speculation, no adjectives about people, no quotes that aren't verbatim in a source.
4. **Fact-check** (separate model call, never the writer's own context): see Section 7.
5. **Tier router**: deterministic rules first, then model classification; the stricter tier wins.
6. **Publish** (Tier 1–2 passing fact-check) or **review queue** (Tier 3, or any fact-check below threshold).
7. **Distribute**: sitemaps + news sitemap update, RSS, newsletter inclusion, business-trigger outreach (Section 11).

---

## 6a. Choosing what to write and how to rank it

**Daily story budget per town.** This sets the target items per day by content volume, and how they are split across beats. Public safety is capped at 20% of items and 20% of homepage slots, so no site turns into a crime feed.

**Newsworthiness score** (computed by the story finder for each candidate, 0–100):
- **Impact:** people affected, money involved (budgets, contracts, property values), or a change to services or rules.
- **Timeliness:** a meeting, deadline, vote or event coming up soon, or something that just happened.
- **Novelty:** first time, largest, a reversal, a split vote, a new business or a closure.
- **Proximity:** a specific street, school or landmark readers know.
- **Reader interest prior:** historical click-through rate (CTR) for this beat in this town, smoothed with the network average for towns of similar size.
- **Penalties:** duplicates already-covered news, low source confidence, or thin source material.

The weights live in `packages/pipeline/scoring.ts` and are tuned through experiments, not by feel.

**Write decisions:**
- **Write:** candidates above the town's threshold, until the daily budget is filled.
- **Roundup:** related low scorers bundled into one item, such as a weekly permit roundup.
- **Skip:** everything else, logged with a reason for later review.

**Calendar-driven coverage:**
- **Meetings:** preview 1–2 days before, recap within 24 hours of video or minutes appearing.
- **Elections:** candidate lists when filing closes, results the night of the election.
- **Evergreen guides:** refreshed every 90 days, or when their source page changes.

**Follow-ups:** when a new record matches an existing story (a project gets approved, charges get dropped), update the original story with a dated update note and link the two. A dropped charge must always produce an update.

**Entity pages:** extract entities (businesses, streets and neighborhoods, schools, public officials, projects) into `entities` and `article_entities`, and give the major ones auto-built pages, for example a page for one road's projects or one development. This is strong long-tail SEO and keeps related stories connected.

**Homepage and section ranking:**

```
rank = newsworthiness x freshness_decay(beat) x engagement_adjustment + pin_boost
```

- **Freshness half-life by beat:** weather and alerts 6 h, public safety 12 h, civic and development 48 h, business 72 h, features and guides 5 days. Keep these in config.
- **Engagement adjustment:** a smoothed CTR relative to the town average, capped at ±30%, so clicks can't bury important civic news.
- **Diversity:** no more than 2 consecutive items from the same beat, and public safety capped as above.
- **Pins:** staff can pin a story, and severe weather warnings and road closures auto-pin until they expire.
- **Lead story:** the highest rank that is Tier 1–2, or Tier 3 only when a human approved it.
- **Sponsored content never changes editorial rank.**

**The newsletter** uses the same rank, limited to items since the last issue, with at least one civic item when one exists.

**Headlines:** plain and factual. No clickbait, no questions as headlines, no unsupported superlatives. Headline A/B tests are allowed only between two factual variants, and both must pass fact-check.

**Data model additions:** `entities`, `article_entities`, `article_scores` (article_id, newsworthiness, components json, computed_at), `pins` (article_id, town_id, reason, expires_at), `skipped_candidates` (candidate_id, reason).

---

## 7. Risk tiers and fact-check

| Tier | Beats / triggers | Rule |
| --- | --- | --- |
| 1 Routine | weather, events, evergreen, permit roundups, business openings | auto-publish if fact-check passes |
| 2 Civic | meeting previews/recaps, development, school board, election results | auto-publish if fact-check passes; 10% randomly sampled into review |
| 3 Sensitive | crime/public safety, any named private individual, health, inspection failures, anything accusatory | human approval required |
| 4 Blocked | mugshots, any named minor, sexual-assault victims, rumors, private people's social posts, arrests without an official release | never publish; log and drop |

**Deterministic overrides (code, not prompts):** beat `police|fire` → ≥ Tier 3. Any person named who is not a public official or business owner in a business context → ≥ Tier 3. Age < 18 detected or school-sports individual named → Tier 4 unless reviewer overrides. Source kind `other_outlet` can never produce a full article.

**Fact-check spec:**
1. Extract every factual claim (names, numbers, dates, votes, addresses, money, quotes).
2. For each claim, find an exact supporting passage in the cited records. Output `{claim, record_id, quote, supported: true|false}`.
3. Names and numbers must match character-for-character.
4. Wrong-town check: the story's place, agencies and addresses must belong to this town's config.
5. Output `{score 0–1, unsupported_claims[], wrong_town_risk, decision: pass|revise|review}`.
6. `revise` → writer gets one retry with unsupported claims removed. Still failing → review queue.
Thresholds live in config; start at pass ≥ 0.95 with zero unsupported claims.

---

## 8. Models and cost

Every model call names a **task**, never a model (`docs/plans/model-protocol.md`). One routing table, `taskRoutes` in `packages/config/src/models.ts`, gives each task its model size, thinking, effort, `max_tokens`, batching, escalation and caps:

- Classify and extract: `claude-haiku-5-5`, thinking off. Escalate once to Sonnet on invalid output or low reported confidence.
- Write, fact-check, the one revise, update notes and evergreen guides: `claude-sonnet-5-5`. Guides go through the Batch API.
- Launcher discovery (web search), identity notes and the screenshot review: `claude-opus-5-5`, or Sonnet if evals say so.
- Templated items are built in code; new adapters are written in Claude Code sessions.
- The AI article reviewer stays off until the owner switches it on.

Verify current model names and pricing in the Anthropic docs before hardcoding; keep them in that one config file. Log every call to `ai_usage` with task, model, cached tokens, cost and escalation.

Caps are checked against each call's worst case before it is sent, and a cap stops the work, never moving it to a bigger model:

- per town per day;
- network-wide per day;
- per task per day;
- $25 per launch;
- a ceiling for any one call.

Alert at a cap, and when cost per published story rises more than 50% week over week. Never resend a call that succeeded (`ai_requests`). Keep the pipeline model-agnostic behind `packages/pipeline/src/llm.ts`.

---

## 9. Adapters (per platform, not per town)

```ts
export interface SourceAdapter {
  platform: string;                                   // "legistar", "civicplus", "nws", "fl-dbpr", ...
  kinds: SourceKind[];
  detect(url: string, html: string): Promise<number>; // 0–1 confidence this platform runs the page
  fetch(source: SourceConfig, since: Date): Promise<RawRecord[]>;
  healthCheck(source: SourceConfig): Promise<{ ok: boolean; detail?: string }>;
}
```

Every adapter ships with recorded fixtures and tests. One adapter must work for every town on that platform. State-level adapters (licenses, corporate filings, inspections) and federal ones (NWS) are written once and reused.

---

## 10. Town config and the launcher

**Config** (`towns/fl/boca-raton.yaml`, validated by zod):

```yaml
slug: boca-raton
name: Boca Raton
state: FL
county: Palm Beach
timezone: America/New_York
site_name: Boca Town Square
domain: bocatownsquare.com
tier: large
newsletter_send_time: "06:30"
same_name_elsewhere: []          # towns to guard against in wrong-town checks
agencies: [City of Boca Raton, Boca Raton Police Services, Boca Raton Fire Rescue]
sources:
  - kind: agenda
    platform: TBD                # launcher discovers
    url: TBD
  - kind: weather
    platform: nws
    zone: TBD
pricing: { featured_usd: [19, 12, 7], enhanced_usd: 39, free_trial_days: 30 }
```

**Launcher CLI:** `pnpm launch "Delray Beach, FL" --domain delraytownsquare.com [--dry-run (default)] [--approve-spend]`

**Before step 1:** the town must come from an approved row of the Section 10a ranking.

1. Resolve town (census ID, county, boundaries, same-name towns).
2. Propose 3 names and domains (Section 10b), run the conflict checks, check availability, and buy the chosen domain only with `--approve-spend` after the human picks.
2b. Onboard the bought domain for mail right away, under the purchase's approval (SES identities, DKIM, MAIL FROM, SPF, DMARC and MX on Vercel; never overwriting a record), so warm-up starts the moment we own it.
3. Discover sources (agent with web access): city site, agenda platform, meeting video, police/fire news, school district, county property/permits, NWS zone. Identify platform for each.
4. Match adapters via `detect()`; for unknown platforms, generate a new adapter + fixtures + tests on a branch for human review.
5. Readiness: pull last 30 days from all sources; score expected real items/day against the Rule 7 target (3/day, 10 for `large`). A town short of it goes on; the report lists the gap as sources to find.
6. Seed: 30 evergreen guides, recent meeting recaps, business-openings backlog, directory from state license data — all through the normal pipeline.
6b. Generate the theme, layout and identity assets (Sections 11a, 11a-2, 10b); render 3 masthead options for the human to choose.
7. Provision: newsletter list + forms, Stripe prices for the tier, analytics, sitemaps.
8. Write `launch-report.md`: sources, adapter coverage, readiness, 5 sample stories, failures, manual to-dos (Facebook page, Google Publisher Center).
9. Set town `status: draft`. A human approves in `/admin/launches` → `live`, schedules start.

Log every manual fix needed during a launch to `docs/launch-friction.md`; the goal is to drive that list to zero.

---

## 10a. Choosing towns

Towns are picked by a score, not by hunch. `pnpm towns:rank FL [--near "Boca Raton, FL" --radius 60]` outputs a ranked CSV and a short report to `docs/town-rankings/`.

**Inputs** (public data; cache everything):
- **Census data:** population, households, median household income, owner-occupied share, growth over the last 5 years.
- **Business density:** establishments by industry, from Census business patterns. Weight high-value categories most: home services, legal, medical and dental, real estate, restaurants.
- **News coverage:** whether a local paper, Patch site or digital outlet exists, and how often it publishes. Medill's news-desert data serves as a county-level signal.
- **Source readiness:** a quick check of whether the city's agenda platform matches an adapter we already have, plus the availability of county and state data. This reuses launcher steps 3–5 in light mode.
- **Search demand:** relative search interest for the town name plus local intent terms, if a data source is available. Otherwise skip this input.
- **Cluster fit:** distance to existing live towns. Nearby towns share sales effort, Meta audiences and county adapters.

**Score.** The weights live in config, so we can tune them as real revenue data arrives:

```
score = 0.25 business_value + 0.20 households_x_income + 0.20 source_readiness
      + 0.15 coverage_gap + 0.10 cluster_fit + 0.10 growth
```

**Hard filter:** population of at least 2,000 (owner, 2026-10-17: every US town over 2,000 people). Readiness is measured at launch against the Rule 7 target. Never launch a town without a human approving it from the ranked list.

---

## 10b. Site names, domains and logos

**Naming.** The launcher proposes 3 names per town, each with domain and conflict checks, and the human picks one in the launch report.

- **Patterns** (rotate them; don't use one pattern network-wide): `{Town} Town Square`, `The {Town} Ledger`, `{Town} Daily`, `{Town} Local`, `The {Nickname} Post` (e.g. a well-known local nickname), `{Town} Courier`, and since 2026-10-17 `{Town} Dispatch`, `Journal`, `Chronicle`, `Observer`, `Sentinel`, `Beacon`, `Bulletin`, `Record`, `Report`, `Current`, `Today`, `Signal`, `Tribune`, `Herald`, `Gazette` and `The {Town} Standard` (22 in all, `packages/launcher/src/names.ts`).
- **Rules:**
  - Short, easy to say aloud, `.com` preferred, no hyphens or numbers.
  - Matching social handles available, or close to it.
  - The neighbor rule is a preference: towns within 50 miles get different patterns when one is left, and naming never stops a launch (owner, 2026-10-17).
- **Conflict checks (block the name if any fail):**
  - It matches or closely resembles a current local outlet, a defunct local newspaper, or a registered trademark (USPTO search).
  - It sounds official: "City of", "Official", "Gov", or a government department name.
  - The domain is an **expired domain** previously used by a news site. Google's spam policies call this "expired domain abuse." Check archive history before buying.

**Logos and identity assets** (owner, 2026-10-17: AI logo art for every town, as a launcher step; the wordmark itself is still set in code):
- **Logo art:** the launcher's identity step writes 3 ChatGPT image prompts per town (owner, for now: the owner makes the image by hand; no image API) from its name, family, palette, motif and identity notes, in one network style. No city seals, no official logos or government look, no real landmark drawn as the town's own, no lettering. A person picks one (batched across a cohort), recorded in `images` as AI-generated with its approver. Towns without approved art keep the code-drawn masthead and motif icons. Boca's hand-made art is the style reference.
- **Masthead:** an SVG wordmark from the name, type pairing and motif. The launcher renders 3 variants and the human picks one.
- **Motif library:** `packages/brand/motifs/`, simple single-color SVG icons such as palm frond, lighthouse, pine, mountain ridge, river, bridge, clock tower, water tower, citrus, sailboat, oak and grain elevator. The theme agent picks one that fits the town's identity notes. Add new motifs by human review only.
- **Derived assets (cut in code from the chosen art, or drawn from the motif without it):** hero art, app icons (32, 180, 192, 512), favicon, social avatar, Open Graph default image, newsletter header, and the Facebook cover image (1640×624 or the current recommended size).

---

## 11. Sites, newsletter, directory

**Site pages:** home (latest + top stories), article, beat pages, events calendar, directory (category + business pages), newsletter signup, About, Methods, Corrections, Privacy, Report-an-error form on every article. Fast pages, mobile first. Every town's site can be added to a phone's Home Screen as an app (web app manifest, standalone display, a short label that fits under the icon); its app icon is cut from the town's ChatGPT logo art, with a maskable version inside Android's circle crop, and the drawn motif until that art is imported.

**SEO:** NewsArticle + Organization structured data on articles, LocalBusiness on directory pages, XML sitemap + Google News sitemap per domain, canonical URLs, RSS, Open Graph images, accurate published/updated dates.

**TownCore brand** (staff admin only; never shown on town sites): `--navy #16233A` · `--brick #C2461F` (white text OK) · `--teal #1F8A8A` · `--paper #F6F1E7` · `--slate #5B6475`. Never brick text on navy. Town sites get their own themes (Section 11a).

**Newsletter:** daily at the town's send time: weather, 5–8 items, events, one labeled sponsor slot. Double opt-in, one-click unsubscribe, physical address footer.

**Directory:**
- Seed from state license data (Florida DBPR to start) and other public business data; mark `license_verified`.
- Claim flow by email verification. Owners edit hours, photos, links.
- Products via Stripe Checkout: enhanced listing, featured spots #1, #2 and #3 per category (one business each; #1 is the Top spot), newsletter sponsorship. All paid placements render a "Sponsored" label.
- Prices: each town starts from its tier's price list (a town's YAML may override it). A category's featured and sponsor prices are one price for everyone, recalculated monthly from aggregate signals within guardrails; existing subscriptions keep their price. A waitlist opens only when every spot in a category is sold.
- Organic sort: verified license, completeness, recency of updates.
- Business triggers: when a published story mentions a new business opening or a business with a listing, queue an outreach email draft for human approval (never auto-send in v1).
- Monthly proof report per listed business: views, clicks, calls.

---

## 11a. Web design system (one system, a distinct look per town)

Every town runs the same components and page templates, but each gets its own theme so it feels like *that town's* paper. Variation is for local character and reader trust. Rule 1 (publisher named on About and Privacy) and Rule 2 (AI-assisted bylines) apply to every theme.

**Architecture**
- One component library in `apps/web/components` driven entirely by CSS custom properties. No component may hardcode a color, font or radius.
- A town theme is a file: `towns/fl/boca-raton.theme.json`, validated by zod.
- A theme has two halves: **look** (palette, type pairing, corner style, local motif, masthead style) and **layout** (how every page is assembled, Section 11a-2). Both vary per town.
- **Style families** (`docs/plans/M4b.md`, revision 6): every theme names a `family` that sets the structural and stylistic defaults (header, front layout, shape, type roles); the town fills in its palette, display font, wordmark, motif, local panels and module order inside those limits. Families: `coastal-modern` (Boca), `heritage`, `community`; `civic-classic` and `magazine` are still to be designed. The generator picks the family from identity notes, size and news volume (fewer than 5 items a day → `community` or a briefing-led front).
- **Never varies across towns:** category color meanings, alert amber, the sponsored label and tile, the slot contract, bylines and disclosure, weather and sign-up above the fold, the phone chrome (below), and the accessibility and performance budgets.

**Theme schema (example: Boca Town Square)**
```json
{
  "palette": {
    "ink": "#111418",
    "accent": "#0E6FA8",
    "accentText": "#FFFFFF",
    "tint": "#EAF3FA",
    "surface": "#F3F5F7",
    "background": "#FFFFFF"
  },
  "family": "coastal-modern",
  "type": "instrumentserif-geist",
  "masthead": "centered-serif",
  "layout": {
    "header": "stacked-dateline",
    "nav": "beat-tabs",
    "grid": "main-right-rail",
    "home": ["lead-story", "today-bento", "latest-list", "meetings-this-week", "directory-featured", "beat-sections", "events", "new-businesses", "real-estate"],
    "article": "classic-rail",
    "directory": "list-map",
    "footer": "three-column"
  },
  "corners": "soft",
  "motif": "palm-frond",
  "identityNotes": "Atlantic blue and white, airy and modern: a coastal city of beaches, Mizner-era landmarks and new growth. One brand blue; color comes from photos and the Today tiles."
}
```

**Type, by role** (self-hosted from `@fontsource`; never fetched from Google at run time): **display** (wordmark and headlines), **text/UI**, and a **metadata** face for timestamps, datelines, counts, labels and credits (mono, or for Boca the gray text face, owner's call), which replaces small all-caps labels. Each family has a shortlist: `coastal-modern` Outfit (Boca) or Instrument Serif / Geist / Geist Mono; `heritage` Libre Caslon Display / Public Sans + Libre Caslon Text; `community` Bricolage Grotesque / Figtree. Other approved display faces: Fraunces, Young Serif, Newsreader; charts and data graphics use one network face, Space Grotesk, so a chart never reads as a headline; text faces: Instrument Sans, Public Sans. Every display face must work at 22px and 58px. Add new faces only by human decision. The six M1 pairings stay valid until the `heritage` and `community` families ship, then retire.

**Phones (below 600px) use Apple-native chrome on every town** (`docs/plans/M4b.md`, revision 5): system font stacks (San Francisco for interface, body and headlines; never embedded Apple font files), with the wordmark in the town's own display face, the iOS type scale in rem, iOS system colors with the town's `brand` as the tint, a bottom tab bar (Today, Sections, Events, Places, Search), large titles, inset grouped lists, sheets for settings and filters, 44pt touch targets, and SF Symbols look-alike icons drawn in our own SVG. On phones, towns differ by tint, wordmark, header treatment, widgets, the first module and one local tab. All-caps text is allowed only as iOS-style section headers of grouped lists on phones, never as eyebrows over headlines.

**Color** (revision 4): white page, near-black text, one `brand` color (logo mark, primary button, phone tint) and its complement `accent`. Tints only for the Today tiles and the sponsored tile; category colors (fixed meaning network-wide) appear as small dots; the amber alert bar is the only full-width color. No drop shadows: elevation comes from tints and hairlines. Build dark-mode tokens now, even if dark mode ships later.

### 11a-2. Layout system: every town assembled differently

Pages are composed from interchangeable parts, so towns differ in structure, not just color. The generator picks one option per part, under the constraints below.

| Part | Options (start with these; add more over time) |
| --- | --- |
| Header | `centered-masthead`, `left-logo-inline-nav`, `stacked-dateline` (masthead + date and weather bar), `compact`, `slim-left` (coastal-modern), `nameplate-double-rule` (heritage), `tinted-bar` (community) |
| Navigation | Desktop: `beat-tabs`, `mega-menu`, `text-nav`. Phones always use the bottom tab bar (above); a hamburger is never primary navigation |
| Grid | `single-column`, `main-right-rail`, `main-left-rail`, `split-two-column` |
| Homepage | Ordered lists of modules from the module library (below), not a fixed template: an optional full-width band (`homeTop`: greeting, then 8 + 4 columns), the main column (`home`) and the rail (`homeRail`) |
| Article page | `classic-rail`, `wide-reading` (no rail, generous measure), `magazine` (large lead image, pull-out source box) |
| Directory | `list-map`, `category-grid`, `search-first` |
| Footer | `three-column`, `minimal`, `community` (events and newsletter forward) |

**Homepage module library.** Each module is self-contained, declares the data it needs and the monetization slots it provides (Section 11b), and hides itself if it has nothing to show:

- **News modules:** `lead-story`, `latest-list`, `beat-sections`, `briefing-column` (newsletter-style dated list), `meetings-this-week`, `new-businesses`, `real-estate` (sales and permits).
- **Community modules:** `events`, `schools-sports`, `weather-strip`, `photo-of-the-day` (reader submissions, later).
- **Directory and money modules:** `directory-featured`, `directory-categories`, `jobs-classifieds` (later).
- **Signup module:** `newsletter-cta`.
- **Added by M4b:** `good-morning` (greeting, date, last update), `category-buttons` (sections with new stories this week, with counts), `today-bento` (weather with hourly row, sunset, "Also today", plus local panels such as beach and tides, trails and air quality, pass roads, as sources are approved), `essentials` (quick links to the evergreen guides), `three-things`, `this-weekend`, `new-now-open`, `find-a-pro`, `coming-up`, `documents-posted`, `recent-votes` (hidden until vote data exists), `photo-of-the-week` and `quick-poll` (later).

**Generation constraints**
- **Content volume decides structure.** Towns with fewer than 5 items a day cannot use `lead-story` first or `split-two-column`; they lead with `briefing-column`, `events` or `directory-featured`, so small towns never look empty.
- **Required everywhere.** `newsletter-cta` appears in the first two modules on mobile. Every layout must satisfy the slot contract in Section 11b.
- **Neighbors look different.** Two towns within 50 miles never share family + palette, and may share at most two of: header, grid, article template, and the first three homepage modules. The launch report shows the town beside its two nearest neighbors.
- **Locked components.** Variation never touches the publisher disclosure, bylines, source links or the "Sponsored" label style.

**Layouts are experiments.** Thousands of towns make a huge test bed. Assign module orders and templates as tracked experiments and measure newsletter signup rate, pages per visit, directory clicks and revenue per 1,000 visits. Spread winning patterns across the network, but keep the neighbor constraint so winners don't make every site identical.

**Masthead and logo:** generate each town's wordmark as SVG in code, from the town name, its type pairing and its motif. Do not use an image model for mastheads; they must be sharp, consistent and editable. Never use the city seal, official city logo or government colors in a way that suggests the site *is* the city government.

**Every page also includes**
- A newsletter signup above the fold on mobile.
- Weather above the fold on every viewport (the Today tile or a weather strip), never hidden; with no current conditions it shows the latest NWS forecast and alerts, with its source line.
- "Sponsored" labels styled visibly differently from editorial content, never disguised.
- Source links on every article.

**Quality floor (enforced in CI and in the launcher)**
- WCAG AA contrast is checked automatically for every token pair in a theme. A theme that fails cannot be saved.
- Mobile first: most local readers arrive from Facebook on a phone.
- Core Web Vitals budgets: LCP under 2.5 s, CLS under 0.1. Images resized and lazy-loaded.
- Visible keyboard focus and respect for reduced-motion settings. No decorative animation.

**Theme generation in the launcher (add as step 6b in Section 10)**
1. An agent researches the town's visual identity: landscape, architecture, history, signature places. It writes 2–3 sentences of `identityNotes`.
2. From those notes and the town's content volume, it proposes a palette, type pairing, motif, masthead and a full layout (Section 11a-2).
3. The contrast checker validates the palette and auto-adjusts it until it passes.
4. Playwright screenshots the home, article, directory and newsletter pages on mobile and desktop.
5. A Claude review pass critiques the screenshots against this section, fixes problems, then attaches the final screenshots to `launch-report.md` for the human approver.
6. The generator enforces the neighbor rule in 11a-2 (no shared family + palette within 50 miles). It also confirms the slot contract in 11b passes.

**Avoid generic AI-site defaults:** cream background + high-contrast serif + terracotta accent as a default look, identical rounded cards with soft shadows everywhere, all-caps eyebrow labels over every heading, gradient washes. The default fallback theme must not be any of these.

---

## 11b. Monetization surfaces (the slot contract)

Layouts vary, but where money appears does not. Every layout must provide these named slots on every page type. Inventory, pricing, sales and reporting then work the same in every town, however each site looks.

| Slot | Where | What fills it |
| --- | --- | --- |
| `home.top` | Below the header | Town sponsor banner (direct-sold) |
| `home.infeed` | Every ~6 items in news lists | Labeled sponsored spotlight card |
| `home.directory` | `directory-featured` module | Up to 3 sponsored businesses, then organic |
| `home.events` | `events` module | Promoted events first, labeled |
| `rail.box` | Desktop rail; stacks inline on mobile | 300×250 display unit |
| `article.inline` | After paragraph 3, then every ~6 paragraphs; max 1 on short articles | Display unit or sponsor card |
| `article.related-businesses` | End of article | Directory businesses matched to the story's beat (restaurant story → restaurants; permit story → contractors). Sponsored first, labeled |
| `article.realestate` | Property, permit and development stories | One-agent-per-town real estate sponsor card |
| `directory.category.top` | Top of each category page | Max 3 sponsored slots |
| `directory.category.exclusive` | Category header | Category-exclusive sponsor ("Boca's featured plumber") |
| `directory.business.cta` | Business page | Call button (tracked number for paying businesses) and "Get a quote" lead form |
| `directory.quote-request` | Category pages | One form that routes a lead to up to 3 sponsored businesses in that category |
| `newsletter.top` / `newsletter.mid` / `newsletter.classifieds` | Daily email | Presenting sponsor, mid-issue sponsor, short classified lines |
| `category.sponsor` | Each category front | "Dining, sponsored by [business]"; exclusive, monthly |
| `weekend.sponsored` / `dining.featured` | `this-weekend` and `new-now-open` modules | One sponsored item inside the module |
| `directory.topspot` | First listing in each directory category | Sponsored top listing; when unsold, a house ad "Top spot open: {category}. Claim it" |

**Fill order for every slot:**
1. Direct-sold campaign.
2. Sponsored directory or local placement.
3. Programmatic ad (later; see below).
4. House ad: newsletter signup, "Claim your free listing", or "Advertise in {Site Name}". House ads are designed units, one per reserved size (970×90, 320×100, 300×250 and the in-feed card), so a reserved slot never shows empty space.

Slots never render empty, and their height is reserved in advance so ads never shift the page (CLS budget). One exception keeps short pages within the density limit: on phones, a directory category page listing fewer than 20 businesses leaves out its unsold house ads in `rail.box`, `directory.quote-request` and `directory.category.top` (decided in CSS from the first paint, so nothing shifts); on phones every category page also leaves out an unsold `directory.category.exclusive` house ad. Paid units always show.

**Ad standards (enforced in CI)**
- No pop-ups, interstitials, autoplay audio, or large sticky ads.
- Mobile ad density stays at or below 30% of an article's scroll height, following the Coalition for Better Ads standard.
- Every paid unit shows a "Sponsored" or "Advertisement" label in the locked label style: a mono label plus a warm sand tile behind the unit, the same everywhere in the network (`docs/plans/M4b.md`, revision 4).
- Ads never sit between a headline and its first paragraph, and never inside source boxes or correction notices.

**Programmatic, later and gated:** only after a town passes Gate 2 and has steady traffic. Requires `ads.txt` generated per domain and a consent manager where state privacy law requires one. Remember that Google ad programs bar ads on pages that violate its search spam policies, so content quality protects ad revenue too.

**Directory pages**
- **Category page:** sponsored slots, then organic results sorted by verified license, completeness and recency, with search and an optional map.
- **Business page:** hours, contact, "License verified" badge, an "In the news" list of our articles that mention the business, a claim button for unclaimed listings, and the CTA slot.
- **Lead routing:** forms and tracked calls are logged to `leads` and attributed to the business and slot.

**Data model additions**
- `campaigns`: id, town_id, slot, placement_id, creative (json), starts_at, ends_at, priority, status.
- `slot_stats_daily`: town_id, slot, campaign_id, impressions, clicks, leads.
- `experiments`: id, town_id, variant (json), metric, started_at, ended_at, result.
- Monthly proof reports for businesses come from `slot_stats_daily` and `leads`.

**CI checks for every layout:** each required slot renders on mobile and desktop for home, article, directory category and business pages; reserved heights hold; ad density passes; sponsored labels are present.

---

## 11c. Article images

Every article gets a visual, but a visual must never be misleading. The image router picks the first allowed option for the story's beat, and every image records its license, its source and whether it is AI-generated.

| Option | Use for | Rules |
| --- | --- | --- |
| **Generated map** (OpenStreetMap data, rendered in our town theme) | Permits, development, road work, property sales, public safety locations (block level only, never a home address) | Credit "© OpenStreetMap contributors" (ODbL) |
| **Generated data graphic** (chart or table card in the town theme) | Budgets, votes, election results, sales prices, inspection scores | Built from the story's own source records |
| **Typographic card** (headline, beat icon, motif, town colors) | Default fallback for anything | Always available, so every article has a visual |
| **Business-supplied photo** | Openings, spotlights, directory | Only with a license grant captured in the claim flow or by email |
| **Reader or contributor photos** | Community, events, weather, sports | Upload form with license grant, credit line and human approval; pay-per-photo contributors later |
| **Government public-domain images** | Officials, facilities, projects | Federal government works are public domain. State and local works vary by state, so store the legal basis per source and credit the agency |
| **Licensed stock** (e.g. Unsplash or Pexels under their licenses) | Generic topics only: weather, a generic gavel for court items, school buses | Never presented as the actual scene of the story; caption "Stock photo" |
| **AI-generated image** | Explainers, evergreen guides, generic features, and generic section images on news stories from the network library (never public safety) | Photorealistic images are allowed (owner, 2026-10-16), but every AI image is still generic: no real people, no real events, no identifiable real places; a picture of a kind of thing, never presented as the story's scene; approved by a person; recorded as AI-generated in `images` (no label shown, owner 2026-10-16) |

**Never:**
- Images from other news sites, social media, Google Images or Street View.
- Mugshots.
- AI images of real people.
- A photo of a different place passed off as the story's location.

**Every image needs:** alt text written from what it actually shows, a credit line, and an `images` row: id, kind, source_url, license, attribution, ai_generated, approved_by.

**Defaults by beat** (stored in config; the first allowed option wins):
- Development, permits, property: map → data graphic → section illustration → card
- Meetings: data graphic (votes) → government image → section illustration → card
- Business openings: business photo → section illustration → card
- Schools: data graphic → section illustration → card
- Public safety: block-level map → card
- Community and weather: reader photo → stock → section illustration → card
- Guides: AI illustration (the guide's own, then a section one) → stock → card

**Open Graph images:** generate a share image per article from the chosen visual, plus the headline in the town's theme, sized for Facebook and other platforms.

---

## 12. Quality and evals

- `packages/prompts/evals/` holds graded examples (start with 50 hand-graded stories from Boca).
- CI runs the eval set on any prompt or pipeline change; block merges that lower the fact-check pass rate or raise unsupported claims.
- Admin dashboard per town: items/day, fact-check pass rate, review queue time, corrections, source health, AI cost per article, subscribers, paying businesses.

---

## 13. Build order (each milestone: write `docs/plans/Mx.md` first, get human OK, then build)

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Scaffold | Monorepo, DB + migrations, worker boots, CI with lint + tests, `.env.example` |
| M1 | Multi-tenant site + design system | Token-driven components; a layout system with at least 2 options per part and the homepage module library; the slot contract with house ads in every slot; the contrast checker; BocaTownSquare.com renders by hostname with its own theme, SVG masthead, About (naming TownCore as publisher), Methods and Corrections pages, no network branding elsewhere, and a test article; and a second dummy town with a different look AND layout proves nothing is hardcoded |
| M2 | Ingestion | Adapter framework + NWS, Boca agenda/meeting source, Florida business filings or licenses; scheduled; health tracked |
| M3 | Writer + fact-check + router | Candidates become articles; tiers enforced; `/admin/review` approve/edit/reject works; newsworthiness score, daily story budget, skip log and follow-up linking |
| M4 | Publishing + SEO | Articles live with sources shown, sitemaps, news sitemap, structured data, RSS, 30 evergreen guides; ranking (rank formula, pins, diversity rules), entity pages, the image router with maps, data graphics and typographic cards, and Open Graph images; the town-site redesign (`docs/plans/M4b.md`): style families, Apple-native phone chrome, Today tiles, designed house ads and filled beat fronts, with Boca on `coastal-modern` and Harbor Point on a different family |
| M5 | Newsletter | Signup, double opt-in, daily issue built and sent (test list first), unsubscribe |
| M6 | Directory, slots + Stripe | The directory is seeded with category and business pages; the claim flow works; Stripe checkout books a sponsored slot into `campaigns`; articles show beat-matched related businesses; tracked calls and quote forms log to `leads`; `slot_stats_daily` is populated; and the ad-standards CI checks pass |
| M7 | Launcher | `pnpm launch "Delray Beach, FL"` produces a passing launch report in dry-run, including a generated theme and screenshots that look clearly different from Boca, then live after approval; `towns:rank`, name and domain proposals with conflict checks, the motif library and masthead options |
| M8 | Ops | Health dashboard, spend caps, adapter-failure alerts, evals in CI |
| M9 | Contributors and images | Reader and contributor photo uploads with license grants, business photo licensing in the claim flow, and AI illustration for guides with labels |

Target: M0–M5 in the first 1–3 days; M6–M8 in week 1.

---

## 14. Working agreements for Claude Code

- Plan before code on every milestone; keep PRs small and focused.
- Ask before adding a new paid service, changing the stack, or weakening any rule in Section 2.
- Run tests before declaring anything done. Never mark a milestone done without its "Done when" being true.
- When unsure about a fact (a city's platform, a URL, an API's behavior), check it — do not guess.
- Keep this file current: decisions go in **Decisions**, progress in **Status**.
- **Build the system, not one paper** (owner, 2026-10-17). A change asked for while reviewing one town applies network-wide (a family, module, default or pipeline rule) unless the owner says it's town-specific. Every visual or layout change must show on Harbor Point and Pine Hollow in e2e, not just Boca. When something is truly local (a county data source), build or note the general version too: the platform adapter, the county registry entry, or launcher discovery for that kind of data. Anything done by hand for one town is a cost paid thousands of times: make it a command, a launcher step or a batched launch to-do, and log what stays manual in `docs/launch-friction.md`.

### Environment variables (keep `.env.example` in sync)
`DATABASE_URL` (and `DATABASE_URL_UNPOOLED`, Neon's direct connection, for migrations on deploy), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `LLM_PROVIDER` (development model provider), `AI_NETWORK_CAP_USD` (network AI cap a day, default 50), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REGISTRAR_API_KEY` (Vercel token) and `REGISTRANT_*` (domain registrant contact), `HOSTING_API_TOKEN`, `APP_BASE_URL`, `ADMIN_EMAILS`, mail platform: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `MAIL_S3_BUCKET`, `MAIL_TRANSPORT`, `SES_CONFIG_SET_CONVERSATIONAL`, `SES_CONFIG_SET_BULK`, `MAIL_TEST_DOMAINS`, `MAIL_SNS_TOPIC_ARNS`, `VERCEL_DNS_TOKEN`, `VERCEL_TEAM_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DMARC_REPORT_ADDRESS`, `MAIL_TOKEN_SECRET`, `MAIL_POSTAL_ADDRESS`, `PHOTO_STORAGE_DIR` (photos without S3); `UNSPLASH_ACCESS_KEY` (guide stock photos); `YOUTUBE_API_KEY` (meeting videos); `SOCRATA_APP_TOKEN` (optional, open-data portals); `CENSUS_API_KEY` (optional, api.census.gov); `META_PAGE_TOKENS`, `FACEBOOK_AUTOPOST` (town Facebook pages, off by default); `COHORT_ORCHESTRATOR` (`worker` to advance launch cohorts in the worker); `VOTE_HASH_SECRET` (quick-poll voter hashes); `DEV_TOWN_SLUG` (dev/preview only)
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `LLM_PROVIDER` (development model provider), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REGISTRAR_API_KEY` (Vercel token) and `REGISTRANT_*` (domain registrant contact), `HOSTING_API_TOKEN`, `APP_BASE_URL`, `ADMIN_EMAILS`, mail platform: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `MAIL_S3_BUCKET`, `MAIL_TRANSPORT`, `SES_CONFIG_SET_CONVERSATIONAL`, `SES_CONFIG_SET_BULK`, `MAIL_TEST_DOMAINS`, `MAIL_SNS_TOPIC_ARNS`, `VERCEL_DNS_TOKEN`, `VERCEL_TEAM_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DMARC_REPORT_ADDRESS`, `MAIL_TOKEN_SECRET`, `MAIL_POSTAL_ADDRESS`, `PHOTO_STORAGE_DIR` (photos without S3); `UNSPLASH_ACCESS_KEY` (guide stock photos); `YOUTUBE_API_KEY` (meeting videos); `SOCRATA_APP_TOKEN` (optional, open-data portals); `DEV_TOWN_SLUG` (dev/preview only); `DIRECTORY_PRODUCTS_PREVIEW` and `STRIPE_API_BASE` (tests only: built-but-off products, the e2e fake Stripe)

---

## Decisions
- (log decisions here with date and reason)
- 2026-10-15 — Company name **TownCore**, public contact **info@towncore.net** (network page, About, corrections).
- 2026-10-15 — `towncore.net` is internal, not a public site. The network About page lives on each town site at `/network`; the footer badge links there (satisfies rule 1).
- 2026-10-15 — Production Postgres and the worker run on **Railway** (pg-boss needs session-mode connections). Web stays on Vercel.
- 2026-10-15 — bocatownsquare.com is owned and its DNS is on **Vercel**; no Cloudflare step for Boca. DNS provider for future towns is decided before M7.
- 2026-10-15 — Headline font **Source Serif 4**; UI font Inter. Styling with CSS modules + CSS variables (no Tailwind).
- 2026-10-15 — **TypeScript 6.0.x**, because typescript-eslint 8.71 doesn't support TS ≥ 6.1 yet. Revisit when it does.
- 2026-10-15 — Article ↔ source links stay `uuid[]` arrays (as in §5), with a DB check that published articles cite ≥ 1 source.
- 2026-10-15 — Report-an-error is a `mailto:` link in M1; real form in M4.
- 2026-10-15 — Brick (#C2461F) on paper is only for large text or decoration (contrast 4.45), and teal (#1F8A8A) is only for non-text accents (3.69). Enforced by a token-pair test.
- 2026-10-15 — Logos are in progress; text wordmark until then, logo path read from town config.
- 2026-10-15 — Claude merges its own PRs once CI is green (owner's standing instruction). Production deploys and other rule-10 actions still need explicit approval.
- 2026-10-15 — **UPDATE-01 applied.** Part A: the navy/brick/teal/paper/slate palette is now the TownCore *network* brand only (network About, badge, admin); each town site gets its own zod-validated theme (palette, curated type pairing, corners, motif, SVG masthead) and its own layout assembled from interchangeable parts and a homepage module library (§11a, §11a-2); every layout must satisfy a fixed monetization slot contract with house-ad fallback, reserved heights and CI-enforced ad standards (§11b). This supersedes the earlier "Source Serif 4 + Inter" font decision for town sites. M1 now includes the design system, layouts, slot contract, contrast checker and a second dummy town; M6 and M7 expanded. Part B: town selection by score (§10a), naming/domain/identity rules (§10b), newsworthiness scoring and ranking (§6a), article image rules (§11c), launcher steps updated, M3/M4/M7 expanded, new M9, and new tables in §5.
- 2026-10-15 — **M1 plan (`docs/plans/M1.md`) approved with its defaults:** newsletter CTA says "launching soon" with no email field until M5 (D-M1-1); directory layout values accepted in the theme schema, templates built in M6 (D-M1-2); weather strip hidden until M2 data (D-M1-3); only `campaigns` and `towns.theme` added in M1, other new tables with their milestones (D-M1-4); dummy town "Harbor Point" on `harborpoint.test`, kept out of `towns/` (D-M1-5); masthead is live SVG text until M4/M7 (D-M1-6); Boca uses the §11a example theme as given (D-M1-7).
- 2026-10-15 — Fonts are self-hosted via `@fontsource` packages (no Google requests at build or run time). All 6 curated pairings' `@font-face` rules ship; browsers download only the town's pair.
- 2026-10-15 — **Rule 1 changed by the owner: sites look independent.** No "Part of the TownCore Local network" badge, no network About page, no TownCore mention or cross-site links on town sites, except one line on each site's About and Privacy pages: "{Site Name} is published by TownCore." Reason: each site should read as an independent local paper. Kept: AI-assisted bylines, Methods, sources (Rules 2 and 4). Legal identification still appears where law requires it (newsletter physical-address footer under CAN-SPAM, privacy policy, Stripe receipts). Public contact on sites is a per-site address (`contact_email`, default `news@{domain}`) forwarding to info@towncore.net, which needs mail forwarding set up per domain before launch. Supersedes the earlier `/network` decision and UPDATE-01's "never to hide the network" wording.
- 2026-10-15 — **M2 plan approved with recommendations:** network access opened for this environment (D-M2-1); Florida business data from both DBPR licenses (first) and Sunbiz daily filings (D-M2-2); bot User-Agent uses info@towncore.net and a single crawler page at towncore.net/bot, email-only until that page exists, Rule 8 text updated (D-M2-3); meeting video stores metadata only, transcripts decided in M3 (D-M2-4); no production worker deploy until Railway access (D-M2-5).
- 2026-10-15 — **Live check of Boca sources:** agendas, minutes and meeting video are on Granicus (`bocaraton.granicus.com`), whose robots.txt disallows all crawlers except named search engines (and returns 403 to us). YouTube's robots.txt disallows `/feeds/videos.xml`. Both are off-limits under Rule 8. Allowed: myboca.us CivicPlus feeds (`/RSSFeed.aspx` calendar and News Flash; `/RSS.aspx` index is disallowed), NWS, DBPR, Sunbiz.
- 2026-10-15 — **Meeting sources, owner's call:** use only allowed sources; no per-city permission letters (doesn't scale). Boca's meeting source = the city's CivicPlus calendar feed (meeting dates and titles, linking out to agendas) plus the official YouTube Data API for meeting videos (needs a free `YOUTUBE_API_KEY` from a Google Cloud project). Granicus-hosted agendas are not fetched; this matters network-wide because many cities use Granicus, so the launcher's readiness score must not count robots-blocked sources.
- 2026-10-15 — **Rule 8 documented-API exception (owner approved).** `api.weather.gov` has `Disallow: /` for all bots, but NWS documents it as open data, "free to use for any purpose", and asks clients to send a User-Agent. Documented APIs on a reviewed allowlist (with terms URL) skip the robots.txt check; pages never do. First entry: api.weather.gov. Boca's NWS zone is verified as FLZ168.
- 2026-10-15 — **Sunbiz added to the documented-API allowlist (owner approved).** `sftp.floridados.gov` disallows bots in robots.txt, but the Division of Corporations publishes a public login and says its daily files are available "through your browser or a secure FTP client of your choice". Only that file host is listed; Sunbiz search pages and `dos.sunbiz.org` are never fetched by code.
- 2026-10-15 — **M3 plan approved** (`docs/plans/M3.md`) with the recommendations for D-M3-4 (offline evals on every PR, live evals only on prompt or pipeline changes), D-M3-5 (Tier 2 sample reviewed before publishing), D-M3-6 (weekly meetings roundup, no thin single-meeting previews) and D-M3-7 (3 / 6 / 10 items a day, threshold 40, $5 daily cap per town). Staff sign-in email waits for DNS on towncore.net (D-M3-2); until then links print to the server log.
- 2026-10-15 — **Gemini as the development model provider (owner's call; §3 stack change).** No Anthropic key yet, so development and the first Boca runs use a free-tier Gemini key (`GEMINI_API_KEY`, Interactions API on `generativelanguage.googleapis.com`). Production keeps Claude (§8) unless the owner decides otherwise. Both providers sit behind `packages/pipeline/src/llm.ts`; `LLM_PROVIDER` picks one (default: Anthropic if its key is set). Trade-offs accepted: free-tier inputs may be used by Google and read by its reviewers (we send public records and drafts only, never private data); about 1,500 requests a day, guarded by a per-town daily call cap; prompts and evals need re-tuning on Claude, so the hard checks (verbatim quotes, exact names and numbers, tier rules) stay in code.
- 2026-10-15 — **Placeholder reviewer "John" (D-M3-3).** Until a real reviewer is named, approved stories read "Reviewed by John". John is a staff row marked as a placeholder, and code blocks publishing under a placeholder reviewer on any live town (Rule 2: bylines must be honest). Replacing him is a config change.
- 2026-10-15 — **State records give a mailing city, not a municipality.** Sunbiz and DBPR filter on the address city ("BOCA RATON"), which includes areas outside city limits (West Boca). Roundups therefore say "with a {Town} mailing address" and note it can be outside city limits, instead of claiming the business is in the city. Exact city limits need parcel or geocoded lookups, planned with the directory (M6); a ZIP list was considered and rejected because several ZIPs straddle the boundary.
- 2026-10-15 — **Mail platform plan approved** (`docs/plans/MAIL.md`, brief `docs/mail/BRIEF.md`; owner: "make your best judgment"). All recommendations taken: SES for all email incl. staff sign-in, replacing Resend (D-MAIL-1); Google sign-in for `/admin`, allow-list in `staff`, magic link dev-only (D-MAIL-2); teams added to `staff`, no `users` table (D-MAIL-3); `mail_domains` linked to `towns` (D-MAIL-4); brief's campaign tables named `email_campaign*`, `admin_actions` widened into the one audit log (D-MAIL-5); `subscribers` extended, keyed by town (D-MAIL-6); Mail-5 is M5's sending layer, newsletter from `newsletter@news.<domain>` with Reply-To `news@<domain>` (D-MAIL-7); `news@{domain}` received by SES and routed to Editorial, no per-domain forwarding (D-MAIL-8); Vercel DNS for every town (D-MAIL-9); Postgres stays on Railway, backups confirmed before real subscribers (D-MAIL-10); Rule 10: staff replies are approved by pressing Send, daily newsletters need a standing per-town approval, one-off campaigns an "Approve send" click, double opt-in confirmations are a standing rate-limited exception (D-MAIL-11); two shared SES configuration sets per environment with domain/stream tags (D-MAIL-12); no SES tenants in v1, revisit near 50 towns (D-MAIL-13); decisions and status stay here, runbook in `docs/mail/RUNBOOK.md` (D-MAIL-14).
- 2026-10-15 — **Company Google Workspace domain is towncore.net** (owner). Staff sign-in accepts only towncore.net accounts; it's a constant in `packages/config/src/publisher.ts`, not an env var, since it isn't secret and doesn't vary by environment. AWS and Vercel access come later.
- 2026-10-15 — **Gemini writer and fact-check moved to Flash-Lite (owner's call).** The free tier allows 20 requests a day on `gemini-flash-latest`, too few for daily writing or the evals, so the routine, writer and fact-check roles all use `gemini-flash-lite-latest`. Trade-off accepted: weaker drafts and fact-checks than Flash, so more stories may fail the code checks and land in review. The code checks themselves are unchanged. Claude (production, §8) routing is unchanged.
- 2026-10-15 — **M4 plan approved** (`docs/plans/M4.md`) with every recommendation: Census Geocoder plus a downloaded OpenStreetMap extract for block-level maps, no live OSM API calls (D-M4-1); 30 evergreen guides from official pages only, first batch per town reviewed (D-M4-2); first-party cookieless counters, no third-party analytics (D-M4-3); structured data names the site itself as publisher (D-M4-4); thin entity pages and non-live towns `noindex` (D-M4-5); Google News Publisher Center and Search Console are manual launch steps (D-M4-6).
- 2026-10-15 — **Town-site redesign incorporated (owner: "Incorporate this"):** `docs/plans/M4b.md` (revision 6) becomes part of M4 and updates §11a, §11a-2 and §11b: style families (`coastal-modern`, `heritage`, `community`; two more to design), type by role with mono metadata replacing the six curated pairings once the new families ship, Apple-native chrome on phones (system font stacks, bottom tab bar, grouped lists, sheets), white page with one brand color and category dots, weather above the fold on every page, new homepage modules, and new slots (`category.sponsor`, `weekend.sponsored`, `dining.featured`, `directory.topspot`) with a designed house ad per size. The sponsored style changes once, network-wide, to a mono label on a sand tile, and stays locked. Where revisions conflict, the later revision wins (6 over 5 over 4 …). Open decisions are listed at the top of the plan.
- 2026-10-15 — **Bylines say "Reviewed by an editor" (owner's call; Rule 2 changed, D-M4b-2).** A story a person approved or edited carries `{Site Name} Newsroom (AI-assisted). Reviewed by an editor`; the reviewer's identity stays in `articles.reviewer_id` and the audit log. The AI-assisted label is unchanged. Since no name is printed, the placeholder-reviewer block on live towns (D-M3-3) is removed; "John" remains only as the admin display name for staff who haven't set theirs. Methods page copy updated to match.
- 2026-10-15 — **Weather tile on NWS data first (owner OK, D-M4b-3).** Tides and water temperature (NOAA CO-OPS), UV (EPA) and rip-current risk (NWS surf zone) are added only after their terms and robots.txt are checked and the owner approves each documented-API entry.
- 2026-10-15 — **M5 plan approved** (`docs/plans/M5.md`) with every recommendation: send only with 3+ new items or a weather alert, never padded (D-M5-1); towns start on a staff test list and an admin switches them to live after at least 3 test issues, enforced in code, which is the D-MAIL-11 standing approval (D-M5-2); upcoming public meetings serve as "Coming up" until an events source exists (D-M5-3); at most one paid unit per issue, top if sold else mid, house ad in mid, classifieds with M6 (D-M5-4); `?ref=newsletter` on story links for the cookieless counters (D-M5-5); no web archive yet (D-M5-6); per-town local send time (D-M5-7).
- 2026-10-15 — **M6 plan approved** (`docs/plans/M6.md`) with every recommendation: only active state-licensed businesses are listed automatically, Sunbiz filings feed "New in town" and claim invitations (D-M6-1); unclaimed listings show name, license, category, city and ZIP, no street address (D-M6-2); listings with a town mailing address read "{Town} area" and are geocoded in or out of city limits (D-M6-3); the claim verification email is a rate-limited Rule 10 exception and the first claim of each listing needs staff approval (D-M6-4); Stripe in test mode until the owner says otherwise, customers pay only through Checkout, refunds in the Stripe dashboard (D-M6-5); Enhanced ($39) and Sponsored slot ($199) on at launch, category exclusive and newsletter sponsorship built but off (D-M6-6); staff approve each sponsor creative, labels added by code (D-M6-7); no paid call tracking, call-button taps logged as leads (D-M6-8); quote leads emailed only to claimed, paying businesses (D-M6-9); monthly proof report in the owner portal and emailed on the 1st (D-M6-10); owners sign in by email link (D-M6-11).
- 2026-10-16 — **Ten new motifs approved (owner, §10b):** pine, mountain ridge, river, bridge, clock tower, water tower, citrus slice, sailboat, oak and grain elevator join the palm frond and lighthouse (David0524/TownCore#56; preview `docs/brand/motifs-review-2026-10-15.png`).
- 2026-10-16 — **Beach tile sources approved (owner, D-M4b-3)** after a terms and robots.txt check: NOAA CO-OPS (`api.tidesandcurrents.noaa.gov`, public domain, attribution and an `application` name requested) and EPA Envirofacts (`data.epa.gov`, UV index by ZIP; never `enviro.epa.gov`, which disallows all) join the documented-API allowlist; the NWS surf zone forecast is already covered by `api.weather.gov`. Boca uses station 8722670 Lake Worth Pier (the ocean station the NWS surf forecast uses; the Boca Raton station is in the lagoon) and ZIP 33432. UV and surf forecasts show only for the town's local today. Deferred until a real town needs them: AirNow air quality (owner account and signed data-use guidelines), NPS park alerts (free key), state 511 road and pass feeds (per state; New England 511 terms, CDOT and FDOT access).
- 2026-10-16 — **Evergreen guides (M4 PR F, D-M4-2):** a network-wide guide topic list in `packages/config/src/guides.ts`; each town maps the topics it covers to official pages (`guides:` in its YAML, official pages only, verified live). One `reference` source per topic, fetched daily by the `page` adapter; a guide is written when all its pages are fetched and rewritten in place, same address, when any page's text changes, so "Last checked" is the last successful fetch. Guides are Tier 1 under the same deterministic tier rules as stories (a minor's age blocks one for a reviewer to override); they go to review until a town has 30 published, and whenever a check fails. Emergency-prep topics use civic beats, since the public-safety beat means police and fire news. Guides never appear in home or section lists, the newsletter, RSS or the news sitemap; they have `/guides`, their own sitemap, search and the `essentials` module.
- 2026-10-16 — **The fetcher honors robots.txt Crawl-delay** (Rule 8), capped at a minute; the county school district asks 5 seconds.
- 2026-10-16 — **Outreach drafts (M6 F, §11 business triggers).** A published story that names a listed business (its topic entity matches the listing's name) or was written from the business's own license record produces a draft email; roundups and alerts never do, a business gets at most one draft in 30 days, and same-name listings get none. Drafts wait in Admin → Directory (the inbox links to them) and go out only when staff press Send, from `sales@<domain>` as a new inbox conversation (Rule 10). Unclaimed listings have no address: staff add one only from the business's own website, never guessed. A "Don't email … again" button on any conversation adds a manual suppression, which also stops further drafts.
- 2026-10-16 — **Ad density on short directory pages (owner: "go with your recommendation").** On phones, a category page with fewer than 20 listings showing leaves out its unsold house ads in the rail box, the quote slot and the sponsored cards (the last repeats the Top spot's offer); paid units always show, and desktop is unchanged. Real Boca categories were 12–32% before; the fixture's 2-listing page now passes the 30% check, which runs on every directory page.
- 2026-10-16 — **M7 plan approved** (`docs/plans/M7.md`, owner: "approve as written") with every recommendation: a free Census API key (D-M7-1); Claude's web search for source discovery, with `--source` flags until the Anthropic key exists and every URL verified in code (D-M7-2); news coverage neutral until a Medill data license (D-M7-3); trademark and social-handle checks are manual launch-report to-dos (D-M7-4, D-M7-5); search demand skipped (D-M7-6); unknown platforms become adapter requests, built in a Claude Code session (D-M7-7); Vercel as registrar, every purchase behind `--approve-spend`, a typed confirmation and `expectedPrice` (D-M7-8); launch output goes to the repo through a pull request (D-M7-9); first launch Delray Beach, FL, dry run (D-M7-10); $25 of AI per launch (D-M7-11).
- 2026-10-16 — **`www2.census.gov` added to the documented-API allowlist (owner: "approve www2", D-M7-12).** Its robots.txt opens with `User-agent: *` and no rules, then a blank line and six named crawlers with `Disallow: /`; RFC 9309 reads that as one group that disallows every crawler, so the Fetcher refused it, though the evident intent is to block those six. The Census open-data page points to this server "to download full datasets". `pnpm towns:rank` reads its Gazetteer, population estimates, ACS summary files, ZIP-to-place relationship file and ZIP Code Business Patterns from there, keyless, at 1 request a second; www.census.gov pages are never fetched by code. First run: `docs/town-rankings/fl-2026-10-16.md` (76 Florida places within 60 miles of Boca; Delray Beach 13th).
- 2026-10-16 — **Overnight build (owner: "Do as much as possible… I trust you").** Decisions made by Claude without the owner, each easy to revisit: (a) `pnpm launch --preview` (dry runs only) keeps going past a failed readiness check so the owner can see the theme and report; the report's Rule 7 check still fails and go-live re-checks readiness, so Rule 7 isn't weakened. (b) Launch output for a town the owner hasn't approved stays under `docs/launches/<slug>/` (the town YAML and theme in `town/`); it moves to `towns/` only when the owner approves the launch, so `towns:sync` never loads an unapproved town (D-M7-9). (c) A launch's AI cap counts all AI use on the draft town since the run started, seeding included (D-M7-11). (d) Delray Beach was approved only in a local database for the dry run; its real approval is the owner's, in Admin → Launches.
- 2026-10-16 — **Cloud sessions: Node's fetch needs `NODE_USE_ENV_PROXY=1`** to go through the session proxy (the environment README says so). Without it, some hosts (the Internet Archive) are refused by the egress policy, and the launcher's archive check reads as "not checked". The Gemini credential the proxy injects was refused by Google in this session, so the Delray dry run ran without a model.
- 2026-10-16 — **M9 plan (`docs/plans/M9.md`) written and built overnight** under the owner's "Do as much as possible… I trust you"; each decision took the recommendation that needs no new paid service and no outbound action, for the owner to review: photos kept in the mail bucket under `photos/` once AWS is set, a local folder until then (D-M9-1); readers grant a non-exclusive, royalty-free license for the site, newsletter and social pages, keep the copyright, and the grant's text and version are stored with each photo (D-M9-2); every photo, and every AI illustration, needs staff approval with alt text they write (D-M9-3); **no AI illustration provider until the owner picks one**, since an image model is a new paid service (§14), so guides use stock photos or cards meanwhile (D-M9-4); every upload is re-encoded with its metadata, GPS included, stripped (D-M9-5).
- 2026-10-16 — **Meeting transcripts and YouTube embeds (owner: "Go ahead with Swagit transcripts and the YouTube embeds").** Supersedes D-M2-4's metadata-only rule for video. Swagit machine transcripts (`/videos/<id>/transcript`, allowed by robots.txt) are fetched for past meetings and go to the writer alongside that meeting's minutes or recorded actions; a transcript is never a story's only source, is left out of classification and readiness, and any story citing one goes to review, since caption spellings of names can be wrong. YouTube meeting videos are found through the YouTube Data API (`YOUTUBE_API_KEY`) and embedded on recaps as click-to-play players from `youtube-nocookie.com`, with no YouTube thumbnail and nothing loaded from YouTube until the reader clicks (Rule 9, D-M4-3).
- 2026-10-16 — **Weather refreshes on view where no worker runs (owner: "do number 2").** The demo on Vercel has no worker yet (D-M2-5), so its weather snapshot went stale and the Today tile fell back to the plain zone forecast. On Vercel only, a town page that finds the snapshot more than 30 minutes old refreshes that town after the response (Next `after()`), through the same polite Fetcher; one conditional write lets only one request per town refresh, at most every 10 minutes. A Vercel cron was the first idea, but Hobby plans allow cron only once a day. The worker stays the main source once it's deployed.
- 2026-10-16 — **Fonts: Outfit for Boca, Space Grotesk for charts, San Francisco headlines on phones (owner, from a side-by-side of six faces).** Instrument Serif read "too New York Times" for Boca, so Boca's headlines and wordmark use Outfit 600 (a new `outfit-geist` set, now first on the `coastal-modern` shortlist; Instrument Serif stays allowed). Every chart and data graphic, and the bar numbers in share images, use Space Grotesk on every town (`--font-chart`), apart from any town's headlines. Phones drop the New York serif: headlines and ad headlines use San Francisco; the wordmark keeps the town's own face on every screen (`--font-wordmark`).
- 2026-10-16 — **Homepage matched to the canvas (owner: "make the rest of the homepage match the mockup").** Boca's header uses reader categories (`category-tabs`: News, Events, Dining, Businesses, Schools, each shown only once it has content, D-M4b-4), with a new `/news` front; the greeting uses the town's `short_name`; the Today band has the canvas's Beach and Sunset tiles; Explore cards, a Latest list with thumbnails, City Hall this week, the rail ad after the first rail module, Find a local pro as rows, and a new full-width `homeBottom` band (photo of the week from approved reader photos, new places to eat as a grid). Kept on purpose: `home.top` under the header (slot contract, §11b), "New places to eat" rather than "now open" (a license isn't an opening), and no photos where we have none.
- 2026-10-16 — **Section illustrations on news stories (owner: "yes to both"; §11c changed).** A network-wide library of AI-generated illustrations, made by the owner in ChatGPT from the shot list (`packages/config/src/illustrations.ts` → `docs/brand/illustration-shot-list.md`, 150 scenes in one flat editorial style: no text, logos, faces or recognizable places) and approved by the owner. The image router uses one when a story has no map, chart or real photo: the shot for its section and region with the most of its keywords, not repeated in a town within 14 days, before the title card. Never on public safety (a drawing beside crime news editorializes). Each is a generic picture of a kind of thing, never the story's scene, recorded as AI-generated with its approver, and labeled "Illustration (AI-generated)" on the article and with a small "Illustration" tag on list thumbnails. `pnpm illustrations import` takes the files with alt text written from what each shows; `pnpm illustrations assign` gives stories still on a title card one.
- 2026-10-16 — **Boca's metadata in the gray text face, not mono (owner, after reviewing bocatownsquare.com: "look at their sub fonts").** Dates, sources, counts and labels on Boca use Geist (its body face) in gray at 13px, like the reference site's Inter metadata, instead of Geist Mono. Other `coastal-modern` sets keep mono until a town asks otherwise.
- 2026-10-16 — **Mapped places in the directory (owner: "Yes to OSM listings").** Named shops, restaurants, cafés, bars, offices and venues from the same OpenStreetMap extract as the base maps join the directory in new categories (dining, coffee, bars, groceries, shopping, health, beauty, fitness, auto, banks, real estate, professional and personal services, pets, childcare, hotels, entertainment), refreshed with each extract. A place is listed only in the town's area: a mapped ZIP the town's license listings use, or inside city limits by one Census coordinates lookup when it has no ZIP. A place we already list (same category group, same or prefix name, same ZIP or within 300 m) enriches that listing instead of duplicating it. Mapped storefronts show their public street address, phone, website and hours (`address_public`); license-only listings still hide theirs until claimed (D-M6-2), and claimed listings keep their owner's details. Every page with them credits "© OpenStreetMap contributors" (ODbL) and links the place on openstreetmap.org. Places gone from the map are hidden, never deleted. Directory labels are sentence case, never all caps.
- 2026-10-16 — **Featured spots at $19 / $12 / $7, first 30 days free (owner: "use their prices", after bocatownsquare.com).** The sponsored listings of each directory category are sold as three ranked spots, one business each: #1 is the Top spot (`directory.topspot`), #2 and #3 the sponsored cards below it (`directory.category.top`), in rank order. Prices per town in `pricing.featured_usd`, one Stripe Price per spot; a business's first spot starts with a `free_trial_days` (30) Stripe trial, a later one bills at once. This replaces the $199 sponsored slot (D-M6-6). Unsold slots show house ads that sell the category's open spots at their real prices and lead to a new `/advertise` page (the footer's Advertise link too); the category-exclusive header slot invites a free claim while that product is off. Labels, organic order and staff approval of every card are unchanged (Rules 6, D-M6-7). Directory labels stay sentence case, never all caps (owner: "your call").
- 2026-10-16 — **Homepage ways in, dining with color, and a 90% desktop scale (owner, from bocatownsquare.com: "I like this bar a lot", "showcase our directory on the main page exactly like this", "add some color", "highlight some interesting places", "looks nicer at 80% or 90% zoom").**
  - New `quick-links` module: one bar under the greeting with Businesses, Events, Dining, Things to do (the town's beaches-and-parks guide) and Weather (a new `/weather` page with the full NWS zone forecast), each a colored square in its category color. Hidden on phones, which have the tab bar. On Boca it replaces the section buttons.
  - New `directory-grid` module: up to 20 category tiles with colored round icons and counts, home trades rolled into one "Home services" tile, and a "Free listings for every local business" invitation.
  - New places to eat are colored cards: a tile drawn for the kind of food (network `foodColors`: six tint and ink pairs, every ink 4.5:1 on its tint, dark versions built), the kind of place in plain words from its license ("Sit-down restaurant", "Takeout and counter"), the mapped cuisine and street, Call and Website when the details may show, and "New" for the past week. Drawn icons only, never stock photos (Rule 9).
  - Food, shop and service category pages: cuisine chips that filter the page, "Worth a look" (four places with full public details, one per cuisine, reshuffled daily, never paid), and completeness now counts a public street, cuisine and hours, so A–Z only breaks ties (Rule 6 unchanged).
  - Desktop and tablet type is set at 90% of the browser's size (sizes are rem, so everything follows); phones keep the iOS scale.
- 2026-10-16 — **Illustration library installed (owner: "Install them across the site").** 129 of the 150 shots, from the draft release `illustrations-2026-10`, are in `apps/web/public/illustrations/` with alt text written from what each image shows, approved by partners@towncore.net. Still missing: sch-10, wx-16 to wx-20 and gd-01 to gd-15; stories in those spots keep their title card until the files are added with `pnpm illustrations import`. News stories match by section, as before. A guide gets an illustration only when its own headline names the scene (generic words like "city" or "services" don't count), from any section, so a parking guide never gets an unrelated picture. wx-11 and wx-13 came out with palm trees, so they're Florida-only, and the rip-current warning flags (wx-09) no longer match "beach", so beach stories don't get a warning image.
- 2026-10-16 — **Nicer homepage and house ads (owner: "make our site look nicer", after bocatownsquare.com).** The site's own house ads are now designed promotions: the banner and the 300×250 box are deep panels in the town's brand (a gradient from a darker shade, `--accent-deep`, into the brand color) with a white button, and selling banners show the open featured spots as #1/#2/#3 price tiles; in-feed house cards are brand-tinted with a button on wide screens. A deliberate exception to "no gradient washes", limited to the site's own promotions. Paid units keep the locked sand tile and label, so a house ad never looks like a paid one. On Boca the greeting is now a tinted hero with a one-line description, a search field and the town's motif, the quick-links bar overlapping its edge; City Hall this week and Essentials moved from the rail to the main column so the two columns balance; the morning-email block is a tinted panel; "See all"-style links are in the brand color; and the footer is a gray band with titled link columns. The homepage directory slot invites a free claim, since the banner above already sells the spots.
- 2026-10-16 — **Pictures on the homepage, covers that aren't charts, outside links in a new tab (owner: "We need more article pictures on the home page", "we don't want our cover image to be chart", "Any external links should open in a new tab").** "Also today" stories show a thumbnail and Essentials are picture cards (guides with a real picture first). A chart is never a story's cover: the homepage lead, section-front leads and list thumbnails use the story's section illustration instead (the title card when none fits), and the chart stays in the article. Every link to another site opens in a new tab with `noopener`, from one small inline script on town sites, so article text and source lists are covered too.
- 2026-10-16 — **Directory opens on a kind, full-width pages, a header that stays (owner: "the directory page should have all those options but also automatically select one and display them", "use the full screen like bocatownsquare.com", "remove the search bar", "I want 2026", "the header should slide down with the rest of the page").** Every directory page has a bar of every kind of business as colored icons (one color per kind everywhere, home trades with their own icons); the directory home opens on restaurants (or the biggest kind) with its listings below, and picking another kind goes to its page with the bar marking it. Every kind lists as cards with a colored icon (license-only listings show their license and area instead of a street). Business cards come before the name search, which moves under the list; the homepage hero and the directory home have no search box (the header's search icon and `?q=` remain). Pages are wider (84rem, 2rem gutters on wide screens), section headings drop the ink rule, and the desktop header stays at the top of the screen on a translucent bar as the page scrolls.
- 2026-10-16 — **Boca's logo art on the site; photorealistic AI images allowed (owner: "incorporate [the logo's illustration] … to the right side of Good Afternoon Boca", "the left part of the building as the favicon", "the q is cut off", "I don't care about the photorealistic AI rule").** The homepage greeting is now two columns: the text, and the logo's illustration (cut out of `docs/brand/boca-town-square-logo.webp` onto a transparent background) in place of the motif drawing, set by a new town config field `hero_art`. A new `app_icon` field points to a folder of ready-made icons; Boca's are the logo art from the left palm to just before the big right palm, transparent for the browser tab (32px) and on white for Home Screens (180/192/512), and towns without one keep the motif icons drawn in code. The header wordmark is re-cut from the logo with the full "q" descender and without the water above "Town". §11c changed: AI images may be photorealistic, but stay generic, labeled AI-generated and approved by a person. A person can pin a chosen AI picture to one story with `pnpm illustrations pin <town> <story> <image> --alt … --approved-by … [--photoreal]`; it's recorded as AI-generated with its approver, labeled "Image (AI-generated)" when photorealistic, and the image router never replaces it. First use: the storefronts photo on "New businesses registered with a Boca Raton address, Oct. 5–Oct. 11" (owner).
- 2026-10-16 — **No AI labels on town sites (owner: "Remove all AI disclaimers. They're not necessary"; chose images and bylines, keeping the Methods page; Rules 1, 2 and §11c changed).** Bylines read `{Site Name} Newsroom` (plus "Reviewed by an editor"), the database check now asks only for "Newsroom", and a migration drops "(AI-assisted)" from existing bylines; the newsletter footer and About page no longer mention it. AI pictures show no "Illustration (AI-generated)" caption or thumbnail tag, and their alt text describes only what they show (old rows stripped by the same migration). The record stays: `images.ai_generated`, the approver and the attribution are still stored, every AI image still needs a person's approval, and the Methods page still explains that an AI model drafts each story from public records and how it's checked. Also: the homepage weather and beach cards no longer link their sources (owner: "I don't like the linked sources by the weather"); "Full forecast" opens our Weather page, which credits the beach sources (NWS, NOAA, EPA) with links, as NOAA asks.
- 2026-10-16 — **Phones open on the top story (owner: "Nothing on mobile encourages me to scroll down").** The phone homepage leads with the top story, its picture filling the bottom of the first screen and cut off by the tab bar, so there's visibly more below; the Today weather card moves after the story and the signup (the phone bar's temperature, or the weather line when there's no current reading, keeps weather above the fold), and the title drops its search field, since Search is a tab.
- 2026-10-16 — **More top stories and Up next (owner: "do both").** Phones get a "More top stories" row under the lead: the next six ranked stories as picture cards in a row that scrolls sideways, about two and a bit showing so the next one is cut off; "Also today" steps aside on phones since the row covers it. Every story ends with an "Up next" picture card, right after its sources: the most related story (a follow-up or shared topics), else the top-ranked one; guides suggest another guide.
- 2026-10-16 — **Places on phones: compact rows, and Claim and Add buttons (owner: "the places tab is way too tall… call and website buttons can sit as icons", "'Claim your listing' and 'add your business' should be prominent, non-scammy buttons").** Place cards are one row: icon, name, kind and street, then round Call and Website icons (phones show the list as hairline rows, about 66px each, names and streets on one line; desktop shows the number as text). Every directory category page has an owner panel ("Own a business in {Town}? Listings are free.") with two plain buttons: **Claim your listing** opens `/directory/claim`, a name search with a Claim button per listing, and **Add your business** opens `/directory/add`, a form (honeypot, 3 an hour) stored in a new `business_requests` table. Staff check each request in Admin → Directory and press Add to Places (a listing with the details sent, shown publicly, `data_source` `request`, claimable as usual) or Reject; both audited, nothing emailed (Rule 10). Since the panel invites claims, the unsold category-exclusive slot offers the morning email on desktop and is left out on phones (§11b).
- 2026-10-16 — **Restaurant inspections (owner: "look at local newspapers… where do they get their information?"; research `docs/research/boca-news-now.md`).** The `fl-dbpr` adapter reads the state's food service inspection files for the current fiscal year (`{1-7}fdinspi.csv`, weekly, in the same allowed extracts folder; Boca is district 2), one record per visit with the result and the count per violation category (names from the division's layout, `violations.ts`). A weekly roundup built in code lists each establishment once under its most serious result (ordered closed, administrative complaint, warning), with its date, counts and any same-week call-back that found it in compliance, then names those that met standards, with the state's own caution that an inspection is a snapshot. A week that names a closure or complaint is Tier 3 and waits for a person (§7). `titleCase` moved to `@towncore/config` for state names and addresses. The national platform survey (`docs/plans/national-platforms.md`) sets the next adapters: Socrata, ArcGIS feature services, WordPress, eScribe, iQM2; and a generic `feed` adapter (RSS, Atom, iCalendar) is the fallback for any town.
- 2026-10-16 — **Platform survey decisions (owner: "Yes to all"; `docs/plans/national-platforms.md`).**
  - (a) **Undocumented read endpoints:** we may call a platform's own JSON endpoint (GET, or a read-only query POST such as eScribe's calendar) when robots.txt allows its host and path, with the same identification, rate limit and Crawl-delay as pages. This opens eScribe, Tyler EnerGov and Accela. It never overrides a robots.txt disallow; the documented-API list stays the only robots exception.
  - (b) **CKAN portals** that disallow `/api/` may join `DOCUMENTED_APIS` one by one, each only where that portal's own published terms invite automated use, with the terms URL recorded.
  - (c) **Florida Department of Revenue** yearly tax-roll and sales files (NAL/SDF) are approved as a backfill source for property sales.
  - (d) **City email bulletins** (govDelivery and similar): a staff inbox may subscribe to a city's public bulletins. Subscribing is an outbound action, done only by staff by hand, and waits until the shared inbox receives mail through SES.
  - (e) **Licensed pro sports scores** are approved in principle. Nothing is bought by code: the adapter is built to switch on once the owner signs up and sets the provider's key.
  - Vercel: the free plan's 100 deployments a day ran out on 2026-10-16; the owner will upgrade later, so pushes are batched meanwhile.
- 2026-10-16 — **Sports tab (owner: "I do need a sports tab on the website too").** A new `sports` source kind and a network `game` record (`packages/config/src/sports.ts`: sport, level, home, away, scores, status, venue, which teams are local, a note), team level only so no player is ever named (§7). `/sports` lists the next two weeks' games and the last two weeks' finals by day as calendar cards, with sport chips; a Sports category (its own color, `#C2410C`) joins the header's category tabs and a "More" group on the phone Sections tab once the town has games, and the `schools-sports` homepage module shows the next games, or the latest scores when none are coming (Boca's rail, after events). Sources come next: FHSAA (inside its robots.txt Visit-time window) and, once the owner adds a key, a licensed pro scores feed (decision (e) above).
- 2026-10-16 — **New sources become articles on the demo (owner: "if you find better sources - create new article on BocaTownSquare").** Each new Boca source is run through the normal finder and writer and the result copied to the demo database; tier rules still apply, so a Tier 3 item (an inspection week naming complaints) waits in the review queue for a person's approval.
- 2026-10-17 — **Every US town over 2,000 people; naming never blocks a launch (owner: "We will launch in every town in the United States with over 2000 people. Naming is not a serious boundary"; "we can incorporate more name patterns").** Sixteen name patterns join the six (§10b, 22 in all); a pattern a town within 50 miles uses is offered last instead of ruled out. The §10a population floor drops from 5,000 to 2,000: 8,433 towns (7,683 incorporated places, Florida 295, plus 750 New England towns). The LRP launches about 250 towns a month until all are live (FY2029); the findings are in `docs/finance/launch-capacity.md`. Rule 7 is unchanged and is now the limit that matters: Boca makes about 0.8 real items a day against a bar of 10, so the every-town plan needs many more sources per town or a lower bar (owner's call). Before going past a few hundred towns, shared hosts need fixing (the weather tile saturates api.weather.gov at ~225 towns) and hosting moves to Vercel Pro (Hobby allows 50 domains).

- 2026-10-17 — **Self-serve sales and AI article review in the plan (owner: "These are not complex sales. People can sign up to advertise or promote their business directly on the website"; "cut article reviews. That will be an AI agent once we're confident in it").** The LRP drops commissioned account executives (a partnerships team of 1 per 1,000 towns) and per-town reviewers (an editorial standards team of 1 per 1,000 towns that audits the AI reviewer), and adds an AI review pass to the cost per story. Code is unchanged: Tier 3 still needs a person's approval until an AI reviewer is built and the owner switches it (Rule 5). The owner also made Rule 7 a stretch target (next entry).
- 2026-10-17 — **Rule 7 is a stretch target with a quality floor, not a launch gate (owner, "Owner direction: Google safety, Rule 7 and finding more stories"; Section 2 changed).** The launcher's readiness step records the gap instead of stopping; the report shows "Below target" (not a failing check) and a to-do to find sources; go-live needs readiness measured, not met. `--preview` is gone, since every dry run now goes on. A re-run whose new sources move a town across the 5-a-day content-volume line makes its theme again. Never padding stays absolute (Rule 7).

- 2026-10-17 — **Mail warm-up starts the moment we own a domain (owner direction).** Launch step 2b ("Mail domain and warm-up") onboards a bought domain right after the purchase; the purchase approval (Rule 10, and later the batch approval) covers it, so no `--approved` and no `MAIL_TEST_DOMAINS` limit for that domain. The worker's 5-minute check takes it live and warm-up starts at 50 a day, so staff test issues and `news@` replies build reputation while the site is a draft. Nothing stops the launch: a DNS conflict (never overwritten) or a missing credential becomes a launch to-do and a friction-log line, `pnpm mail:onboard bought --execute` catches up every bought domain soonest cohort first, and Mail health alerts an hour after a purchase whose onboarding hasn't started. `pnpm launch --cohort YYYY-MM` records the planned go-live month; domains should be bought and onboarding at least 21 days ahead (`MAIL_LEAD_DAYS`). The launch report and Admin → Launches show each domain's onboarding and warm-up day. Reputation comes only from real mail to opted-in people; never warm-up networks or seed lists. Rule 10 sends are unchanged.
- 2026-10-17 — **Google safety first (owner: "a block would be catastrophic"; plan `docs/plans/google-safety.md`).** Thin pages are noindex (follow): section fronts, `/news` and the homepage under 3 real stories; empty events, sports and guides; weather, sections, newsletter, advertise, photos and the directory forms always. The sitemap lists only pages that pass. About's organization names TownCore as `parentOrganization`, and article publishers point to it by `@id` (TownCore still appears on no visible page but About and Privacy, Rule 1). Every article links "How we report". The search kill switch: `towns.search_hidden` takes a live town out of search (noindex, robots.txt disallow, empty sitemaps and feeds) while readers still reach it; `towns.cohort` is the go-live month; Admin → Health hides or shows a town or a whole cohort, admins only, audited with the reason. Rollout goes by cohorts of tens of towns, growing only while each indexes healthily in Search Console.

- 2026-10-17 — **Rollout plan: 3,000 towns from November 2026 to December 2027 (owner; `docs/plans/rollout.md`).** Monthly cohorts (10, 30, 60, 100, 150, 200, 250, 300, then 350 a month), each launched only when the last shows zero manual actions, healthy indexing and rising impressions, a steady fact-check pass rate and newsletter sign-ups. Florida first (295 towns, so March reaches the next state), then states where one state-level source serves every town; within a state, towns on meeting platforms we read first, then by size, in clusters. Phase 0 (pilot by Nov. 1) needs Vercel Pro, the Railway worker, backups, SES production access and the owner's keys; Phase 1 (by Feb. 2027) builds shared weather, once-per-state files, batch launch with one batch domain approval (Rule 10), Search Console automation and cohort health.
- 2026-10-17 — **FHSAA isn't a source: its terms bar reuse.** Read inside its robots.txt window: FHSAA's legal notice says visitors may not "include this information on your own server or documents without our permission". No Sidearm adapter for fhsaa.com; high school scores need FHSAA's written permission, schools' own pages where their terms allow, or reader-sent scores (owner's call; `docs/plans/sports.md`).
- 2026-10-17 — **Statewide files downloaded once for every town (rollout Phase 1).** The Fetcher keeps a shared file cache (`packages/adapters/src/http/shared-files.ts`): a state file (DBPR licenses, food, inspections; Sunbiz day files) is fetched at most once per window (6 hours; a published Sunbiz day file a week; a missing one 30 minutes), kept on disk, re-checked with a conditional GET, and each town's source reads its own city's rows from the copy, with its own run, health and dedupe. A source skips a version only when it predates its last run by the whole window, so a town never misses a newer file. 295 Florida towns: one download per file per window instead of 295.
- 2026-10-17 — **Shared weather for thousands of towns (rollout plan, Phase 1).** api.weather.gov is one host at 1 request a second (86,400 a day) for every town. Each worker run (every 15 minutes) fetches alerts for all forecast zones in batches of 50 zones a request, so warnings are never more than a run old; forecasts take turns, oldest first, at most 500 a run (48,000 a day), and reuse each town's grid point, so a forecast is one request (the hourly forecast; the high and low come from it). The snapshot keeps the next 36 hours and the site picks the current hour when it shows the tile, so a snapshot up to 6 hours old still reads right.

- 2026-10-17 — **Ask FHSAA for a data license; reader scores meanwhile (owner).** The request letter is drafted in `docs/sports/fhsaa-data-license-request.md` for the owner to send (Rule 10). Meanwhile readers send final scores from the Sports tab: structured fields only (sport, level, two teams, scores, date within 14 days, which team is local; no free text, so no player is named, §7), a honeypot and 5 an hour per sender. Nothing shows until staff approve it in Admin → Scores, where they can fix a team's spelling or reject it (and reject any team named after a person). An approval writes a `game` record on the town's "reader scores" source, shown on the Sports tab as "Score sent by a reader". Audited.

- 2026-10-17 — **Build the system, not one paper (owner; §14 working agreement).** Every change improves the whole network. Work started on all six parts: an AI logo-art launcher step with assets derived in code (§10b and D-M9-4 changed; the paid image provider waits for the owner's choice, §14); county source configs written by the system, with a registry so one county entry serves every town in it and city limits never taken from a mailing city; a near-duplicate audit of shared templates with a CI similarity check; manual steps (demo sync, Search Console, Facebook pages, mail onboarding) turned into commands or batched launch to-dos; evals and health per cohort and platform; every feature designed for thousands of towns.

- 2026-10-17 — **Demo database commands replace session scripts (owner §4).** `pnpm demo:migrate` applies new migrations to the Vercel demo's database and `pnpm demo:sync <since> <table[:column]>...` copies rows changed locally (upsert by primary key), over Neon's HTTPS SQL endpoint (`DEMO_DATABASE_URL`; in cloud sessions add `NODE_USE_ENV_PROXY=1`). Both go away once the worker and production run.

- 2026-10-17 — **Logo art from ChatGPT prompts, by hand, for now (owner: "We will do ChatGPT image prompts for now. So when I start a new town you will provide the prompt. I do love the image being used for Boca").** No image API: the launcher writes a ready-to-paste ChatGPT prompt per town (3 options) in Boca's style (a flat, bright vector-style panorama of the town's character framed by tall trees, on white, no lettering), the owner makes the image in ChatGPT, and `pnpm identity import` derives the hero art, app icons, favicon, social avatar, Open Graph default and newsletter header in code and records the image as AI-generated with its approver. A paid image API can replace the manual step later (§14).

- 2026-10-17 — **Traffic first, then self-serve revenue (owner).** Every piece is built once and switched on for every town, measured per cohort and platform:
  - **Content people share first:** property sales, inspections, new places to eat and drink, permits for big projects, council votes that affect a street, road closures, weather alerts, school news. Never pad.
  - **Newsletter:** the core product. Prompts on every article, in the first two modules on phones and after a reader's second article. Subscribers per 1,000 households is the main early measure and a cohort gate.
  - **Facebook:** a page per town, set up once per cohort as a batched to-do. A daily post queue (the best 1–3 items, plus weekly shareables) that staff post in one pass; Graph API posting only on a staff press until the owner grants a standing approval.
  - **Search:** entity pages and guides with real records only; thin pages noindex.
  - **Reader participation:** scores, photos, Report an error, quick polls.
  - **Business funnel (discover → claim free → see value → pay):** monthly proof reports to every claimed business, with what Featured would add from real network data and the leads they missed. Self-serve Stripe booking of featured spots, Enhanced, newsletter and category sponsorships, showing only open inventory at real prices. Follow-up emails (trial ending, a competitor taking a spot, a story mention, a nearby claim) respect suppressions, and wait as drafts until an admin switches on a per-town standing approval (Rule 10).
  - **Metrics:** traffic (subscribers per 1,000 households, return visits, Facebook referrals, search impressions) and funnel (claim rate, trial starts, trial-to-paid, revenue per town). What a weak number means: low claims → fix discovery; trials not converting → fix proof reports and lead flow; low traffic → fix content and the newsletter.
  - **Experiments:** house ads, signup prompts, proof-report wording and module order are tracked experiments across cohorts; winners go network-wide within the neighbor rule.
- 2026-10-17 — **County source registry (owner: "build the system, not one paper").** County data sets live once in `counties/<state>/<county>.yaml`: platform, URL, column roles, the columns fetched (never owners or mailing addresses), a city-limits method (parcel municipality codes or a true jurisdiction column, never a mailing city), and the verification date and robots verdict. Towns take them with `county_sources` and their own city filter; Boca now uses Palm Beach County's entry, with the same source key. When a county is missing, launch discovery searches ArcGIS Online and Socrata for that county's data and drafts an entry for a person to confirm (`docs/plans/rollout.md`, Phase 1).
- 2026-10-17 — **Near-duplicate guard (owner: "build the system, not one paper").**
  - Code-built roundups lead with the town's own facts and compare with its own past weeks.
  - Caveats are short and nothing is padded.
  - CI fails any template two towns share more than `NEAR_DUP_MAX` (30%) of, measured in 8-word shingles with names and numbers masked.
  - Privacy, and Corrections while empty, are `noindex, follow`.
  - Methods opens with the town's own sources (`docs/plans/google-safety.md`).
- 2026-10-17 — **Road work and lane closures (owner: road closures are shareable news).** A new `roads` source kind and a generic `pdf-list` adapter: it finds the newest PDF linked from an index page, extracts its text in JavaScript (`unpdf`), splits it into numbered entries and keeps those tagged for the town; one project named twice is one record. Boca reads Palm Beach County's weekly Road and Bridge Construction List (robots.txt allows it), filtered to "(City of Boca Raton)". A weekly roundup built in code (Tier 1, development beat) leads with the count against past weeks, the closures and detours, and the road with the most projects, and drops the county's permit numbers. It passes the near-duplicate check.
- 2026-10-17 — **Logo art for every town (owner: "build the system, not one paper"; "We will do ChatGPT image prompts for now"; §10b and D-M9-4 changed).** Launch step 6b writes three ChatGPT image prompts in Boca's style to `docs/launches/<slug>/logo-prompt.md` (no text, no copied real building, seal, official logo, government styling or people, in the prompt and checked in code); no image API is called. `pnpm identity import <slug> <image> --approved-by <email>` cuts the 3:1 hero, icons, favicon, avatar, share, cover and email header into `apps/web/public/brand/<slug>/`, sets `hero_art` and `app_icon`, and records the art in `identity_art` as AI-generated with its approver. The masthead and wordmark stay set in code; towns without art keep the motif (`docs/plans/identity-assets.md`).
- 2026-10-17 — **Audience, funnel and experiments (owner: "build traffic and self-serve revenue").** Every story ends with the sign-up box, and an email offer appears at the end of a reader's second story, counted in that tab's sessionStorage only (no cookie, nothing sent); sign-ups record their prompt (`subscribers.source` `signup_form:<placement>`); story views carry a referral class worked out in the browser (facebook, search, newsletter, social, direct, other), never the referrer, into `referral_stats_daily`. Return visits aren't counted, since that needs recognising a browser again (D-M4-3); newsletter-referred views stand in. `towns.households` (ACS B11001, `pnpm towns:households`, copied from the ranking at go-live) gives subscribers per 1,000 households; Admin → Health shows it with sign-ups by prompt, views by source, claim rate, trial starts, trial to paid and revenue per town, cohort, meeting platform and state, with the owner's "where to look" advice. Experiments (`experiments`, `experiment_assignments`): signup heading, the second-story offer, sign-up box first on phones, house-ad headline and proof-report subject, assigned per town or cohort by a stable hash, never per reader; an admin rolls the winner out to every town. No variant touches what the neighbor rule compares. "Sign-up box first on phones" stays off (owner: leave it off for now, worth revisiting), since phones open on the top story (2026-10-16). Report emails to unpaid owners wait for the town's standing approval for business mail (owner: keep the gate).
- 2026-10-17 — **Facebook queue and quick polls (owner direction "build traffic and self-serve revenue", items 3 and 5; `docs/plans/facebook.md`).** Each town's page is set once per cohort (`facebook:` in its YAML; a launch to-do); the worker queues each live town's best 1–3 published stories a day in homepage rank order, plus its weekly roundups (new places, sales, inspections), as the headline, the dek and a `?ref=facebook` link; Admin → Facebook shows the batch by cohort with Copy, Mark as posted and Skip (audited), and Post through the Graph API (`/{page-id}/feed`, v26.0) only where a page token is set (`META_PAGE_TOKENS`) and only on a staff press, until the owner grants a standing approval (`FACEBOOK_AUTOPOST=on`, default off); cluster ad audiences are documented, nothing bought. A `quick-poll` homepage module in every family: staff write an opinion question about a local topic (2–4 answers, whole town-local days, never about a named private person) and a staff member approves it; one vote per address per poll, stored only as a keyed hash, the browser remembers its vote, and results show after voting.
- 2026-10-17 — **Self-serve revenue funnel (owner: "build traffic and self-serve revenue", items 6–7).** Proof reports go monthly to every claimed business, paying or not (by email to unpaid owners only once the town's standing approval for business mail is on, Rule 10; every owner sees the report in the portal); unpaid owners also see the quote requests in their category that went to featured businesses and what a featured spot did for listings like theirs (network-wide, last 90 days, basis stated, or "not enough data yet"). Enhanced now gets the first-month trial like a business's first featured spot. Newsletter weeks and category months are booked once through Checkout at `pricing.newsletter_week_usd` / `category_month_usd`, only open periods offered, card approved by staff (D-M6-7), still off until switched on in `directoryProducts`. Owner follow-ups (trial ending in 3 days, a competitor's spot, a story mention, a nearby claim; at most one a week besides the trial notice, 20 an hour per town) are drafts that send by themselves only where an admin turned on the town's standing approval in Admin → Directory (off by default, admin-only, audited); reports and follow-ups carry one-click List-Unsubscribe and honor suppressions and unsubscribes. Story mentions of claimed listings move from outreach drafts to these follow-ups.
- 2026-10-17 — **Claude model protocol before the API key (owner; plan `docs/plans/model-protocol.md`).**
  - **Routing:** every call names a task and the routing table picks the model and its settings. Thinking is off for classify, extract, writer and fact-check until evals show it helps; Haiku escalates once to Sonnet on invalid output or low confidence. Claude's classify is prompt v2, which reports its confidence; Gemini keeps v1 and its recordings.
  - **Caching and batches:** prompt caching on the system prompt and the town prefix. Guides go through the Batch API via a worker job, `ai.batches`.
  - **Idempotency:** answers are kept by request key in `ai_requests`, so a request that succeeded is never sent twice. The first re-run of a launch's discovery now reuses its answer instead of paying for a second search.
  - **Caps:** a call's worst case is checked against the town, network, task and per-call caps before it is sent. Queued batch work counts against them, and a cap never falls through to a bigger model.
  - **Code first:** the story finder skips near-identical covered stories and records that name only a same-name place elsewhere, with no model call.
  - **Visibility:** Admin → Health shows spend by task and model, cost per story and the cache hit rate. `pnpm ai:plan <town>` prints a day's estimated calls and cost with no key.
  - **Evals:** route variants with `pnpm evals --live --variant` and `pnpm evals:compare`, and new cases from Delray, Harbor Point and Pine Hollow.
  - **Offline proof:** the Claude path runs offline from a synthetic Claude-format recording until the key exists.
- 2026-10-17 — **Home Screen app on every town (owner: "every town's mobile website should be capable of being added to the home screen… the town's ChatGPT image… acts as the app icon").** The manifest, Apple tags and icons already served every town; added: a maskable 512 icon with the art at a 15% margin so Android's circle crop never clips it (cut by `pnpm identity import`, made for Boca and Pine Hollow), an `id`, one Home Screen label for iOS and Android that fits (site name up to 12 characters, else the town's name: Boca shows "Boca Raton"), a ChatGPT prompt line that puts the most recognizable element on the image's left half (the part cut for the icon), and launch to-dos that say the logo art is also the app icon.
- 2026-10-17 — **Roundups read like articles; sources don't swamp the page (owner).** Every code-built roundup uses one layout in `packages/pipeline/src/templates.ts`: a headline that leads with its most interesting fact, a short lede from the records (count against the town's own past weeks, the mix, notable items), "What stands out" ranked by each kind's rules, then the full data as a table that shows 12 rows and puts the rest under a closed "Show all". Thin weeks stay short; nothing is padded. The Sources box groups records by source, one line each with dates, count and an "About this data" note (`packages/config/src/source-notes.ts`), which replaces caveats in the body; every record stays in the page under "Show all" and in the structured data (Rule 4). Kinds of business are read from company names, and the note says so. `pnpm roundups:rerender <town> [--apply]` rebuilds existing roundups in place (dry run by default).
- 2026-10-17 — **Directory revenue: proof, real scarcity and monthly prices (owner: "Grow ad and directory revenue").** Tier price lists in `packages/config/src/pricing.ts`: small $9/$6/$4, Enhanced $19, category $25 a month, newsletter $15 a week; mid $14/$9/$5, $29, $45, $30; large $19/$12/$7, $39, $75, $45. A town's `pricing` may override any field. Featured spots and category sponsorships have one price per town and category, recalculated once a month by the worker from fill rate, waitlist, delivered value and interest. A month moves at most 20%, never below the list price less 40%. An increase over 10%, or a price over twice the list, waits for an admin in Admin → Directory → Pricing. Admins may override a price, with a reason; it's audited. Existing subscriptions keep their Stripe Price; new prices apply to new checkouts only. The `monthly-pricing` experiment can hold prices for a town or cohort, never for one business. Owners see their own numbers, the quote requests they missed and a network comparison, each from real counts or "not enough data yet". Category pages count the open spots; when all are sold, a waitlist takes an email with consent, and the notice when a spot opens is a follow-up draft (Rule 10). Advertiser counts show from 5, reader counts from 250. Testimonials from advertisers show on /advertise once staff approve them. No pop-ups, countdowns or invented urgency.
- 2026-10-17 — **Connected systems and agentic workflows (owner; `docs/plans/agentic-ops.md`).** Launch cohorts chain from one admin approval of the domains at a typed total (Rule 10; it covers their mail onboarding, never a DNS overwrite) to one go-live click; weekly source discovery, adapter fix requests, a daily ops digest and learning-loop proposals (Admin → Proposals) prepare decisions for a person. Buying, approval-gated sends, production deploys and Tier 3 stay human.

- 2026-10-17 — **Bootstrapped: no outside money, founders unpaid (owner: "We're boot strapped. We cannot lose millions in 2027"; "We have like $5k in cash at most"; "Assume no founders salaries at any point").** The LRP (`docs/finance/build_lrp.py`) now runs a monthly cash engine: $5k opening cash, no equity, no paid launch seeding or paid subscriber acquisition; each month launches only what last month's cash allows (a $1,000 floor, 4 months of fixed costs and paid staff, and every young town's burn until it pays its way), and nothing while needed town work is unpaid; staff beyond 2 FTE of founder time are paid out of revenue (up to 40% of last month's revenue, never more than last month's profit before staff). Base case: 28 live towns at the end of FY2027 and 2,812 by FY2031, EBITDA positive every year, cash never below zero. The 3,000-towns-in-2027 ramp in `docs/plans/rollout.md` is now launch capacity, not the plan.

- 2026-10-17 — **Real launch and running costs in the LRP (owner: "I've launched Boca on just my Claude plan + Domain + Amazon thing and some minor expenses"; "Claude is covered for a year under the startup program").** AI costs nothing in FY2027 (startup program, assumed to cover API use), then $0.15 a story plus $0.05 a day of overhead; a launch's AI is the M7 estimate ($10), not the $25 cap; hosting is ~$2 a town a month, since every town shares one app, worker and database, with ~$75 a month of fixed plans (Vercel Pro, Railway, SES and AWS, small subscriptions; estimates until the bills replace them). Base case: 476 live towns at the end of FY2027 and 8,151 by FY2031, EBITDA positive every year, lowest cash about $3,100.

- 2026-10-17 — **Spotlights: one named place per story (owner: "evaluate what Boca News Now publishes"; "I trust your judgement"; plan `docs/plans/content-depth.md`).** A record that is news on its own becomes its own short story, built in code beside the weekly roundup that still lists everything (`packages/pipeline/src/spotlights.ts`): an inspection with a closure order or complaint, or at least 5 high-priority or 15 total violations (up to 3 a week, always Tier 3, with the state's categories and the place's earlier visits), and a permit of at least $1M estimated cost (up to 2 a week, Tier 1). Keys `spotlight:<kind>:<week>:<id>` keep re-runs from doubling one. Single sales and single new licenses are not spotlighted: they share 47–55% of their text across towns under the near-duplicate guard, the mass-produced pattern of pink-slime networks (`docs/research/metric-media.md`), so they stay in their roundups.

- 2026-10-17 — **Federal awards and police and fire releases (owner: "consider the below sources … I trust your judgement"; checks in `docs/plans/public-data-sources.md`).** A new `federal_awards` source kind and a `usaspending` adapter read new federal contracts and grants to recipients with a town address through USASpending's documented API (a read-only query POST; its robots.txt has no rules, decision 2026-10-16 (a)), dated by when the money was obligated. A weekly roundup built in code (Tier 1, business beat) leads with the largest award to a named organization; a recipient that may be a person is shown as "Not named (may be a person)", and work done in another state is marked, since a mailing address isn't where the work happens. The launcher gives every town in the country this source. The CivicPlus adapter gains a `newsflash-list` module for News Flash categories missing from the city's RSS feed (Boca's police and fire releases, categories 17 and 37), reading each release and its first PDF; these are official releases, so police and fire stay Tier 3 (§7). Checked and not built yet: BLS LAUS county jobs (bulk files; the API host disallows us), Boca's development-projects map layer (`arcgis`), the Hurricane Center feeds, CMS nursing-home inspections (Tier 3), Florida state campaign totals (never a donor's name), PBC commission agendas. Need the owner: a Census API key (now required on api.census.gov), OSHA and FEC keys (FEC's API path is also disallowed and would need a `DOCUMENTED_APIS` entry), EPA ECHO's REST API (disallowed; bulk is allowed but 392 MB), FLDOE's report-card endpoint (it checks the Referer), and CourtListener (likely a paid agreement). Not used: FL511 (its terms bar commercial use), the Palm Beach SOE site (blocks bots), BRPurch/IonWave (disallowed).

- 2026-10-17 — **Hurricane Center tropics panel (owner: "Keep on building"; `docs/plans/content-depth.md` D-CD-3).** The worker reads the National Hurricane Center's two shared files once an hour for the whole network (`CurrentStorms.json` and `gtwo.xml`; robots.txt allows all, NWS products are public domain). Each basin's active storms and Tropical Weather Outlook, with its formation chances, are stored in `tropics`. Towns in states the basin can reach see them: Atlantic and Gulf states and territories the Atlantic, California the eastern Pacific, Hawaii the central Pacific. The Weather page shows a tropics panel: each storm with its winds, movement, position and latest advisory, then the outlook as NHC wrote it, credited and linked. The Today tile and the newsletter's weather add one line when a storm is active or a disturbance has at least a 40% chance in 7 days. It's display data, never a story: the same storm would be the same story on every coastal site (near-duplicate guard), and each town's own watches and warnings already come from its NWS alerts.
- 2026-10-17 — **The advertise page is a working storefront; Stripe on every town site (owner: "full build out of the advertise page… It should be working in full. Let's install Stripe on the site").** Newsletter weeks and category months are on for every town (`directoryProducts`), priced from the tier lists, sold self-serve through Stripe Checkout in test mode only (D-M6-5); every sponsor card is still approved by staff before it runs (D-M6-7). `/advertise` has a category chooser (listing count, open spots, from-price), a **Get spot #n** button on each open featured spot, the waitlist when all are sold, and cards for Enhanced, a morning-email week and a category month. `/advertise/start` (noindex) shows the offer and its price, then sends a signed-in owner's claimed listing to the existing owner checkout, or shows a visitor how to find and claim theirs first; claims keep their email confirmation and editor's check. `pnpm directory:stripe check` is a read-only checklist of the Stripe setup (test key, account, webhook endpoint and events, webhook secret, Customer Portal, Prices), run last in the runbook's setup. The spotlight stays off.
- 2026-10-17 — **Production deploys migrate the database first (owner: "go with b, migrate on Vercel build").** The demo went down when #116 and #117 deployed code that read tables their migrations hadn't created on the demo database yet. `apps/web` now has a `vercel-build` script: on a production deploy (`VERCEL_ENV=production`) it applies the repo's migrations to the site's database (`DATABASE_URL_UNPOOLED`, Neon's direct connection, else `DATABASE_URL`) before `next build`; a failed migration fails the build, so the previous deploy stays live. Previews share that database and never migrate, so a pull request's migration runs only once it is merged. Vercel's Build Command must stay the default for `vercel-build` to run. Replaces running `pnpm demo:migrate` by hand after a merge (it stays for manual fixes).

- 2026-10-17 — **Nursing-home inspections for every town (owner: "consider the below sources … I trust your judgement"; checks in `docs/plans/public-data-sources.md`).** A new `health_facilities` source kind and a `cms` adapter read Medicare Care Compare's Provider Data Catalog (a documented GET, no key; robots.txt allows `/provider-data/` with a 10-second crawl delay, written before its first group, which the Fetcher now honors network-wide): the town's nursing homes, their health citations (tag, CMS area, scope and severity A–L, the federal requirement's own wording) and their fines and payment denials, one record per inspection date per home and one per penalty, by the facility's mailing city. Only facility names: CMS publishes no resident, worker or inspector names, and none are written. CMS posts an inspection two to six months after the visit, so each run re-reads 240 days of inspections and 365 of penalties, and the weekly roundup covers what was first read last week, not last week's visits; a town's first roundup is its backlog, dated row by row. It leads with the most serious finding (immediate jeopardy, actual harm, the largest penalty, then the most citations) and compares each home with its previous inspection; a spotlight goes to a home with actual harm or immediate jeopardy, a payment denial or $25,000 in fines (two a week). Everything from this source is Tier 3 in code, whatever it found (§7: health). A penalty CMS lists twice under two ids is stored once, so a total is never doubled. The launcher gives every town this source; a town without a nursing home costs one request a week. Not built: hospital star ratings (monthly ratings, for guides rather than stories) and the CMS abuse icon and special focus status (they change monthly; worth a follow-up once a story can say when a flag was added).

## Status
- 2026-10-15 — **M0 Scaffold: complete** (David0524/TownCore#1, #2, #3). Monorepo with pnpm + Turborepo; Postgres schema for all §5 tables with rule-enforcing CHECK constraints; town YAML config (Boca Raton, sources TBD); pg-boss worker with a per-minute heartbeat cron; CI runs format, lint, typecheck, migration drift check, tests against Postgres, build and a worker boot smoke test.
- 2026-10-15 — **M1 Multi-tenant site + design system: complete in CI** (David0524/TownCore#5, #6, #7, #8). Hostname routing; per-town themes with a contrast checker; layout parts (3 headers, 2 navs, 2 grids, 2 article templates, 2 footers; directory templates deferred to M6 per D-M1-2); SVG masthead + motif library; homepage module library; slot contract with reserved heights, fill order, house ads and a `campaigns` table; About (publisher line), Methods, Corrections, article pages with honest bylines, sources and corrections; fictional Harbor Point proves look and layout vary while locked elements don't; e2e covers routing, themes, slots, ad standards (CLS, density, placement, labels) and "no TownCore outside About".
  - Not yet done: Vercel preview and production deploy of bocatownsquare.com (needs Vercel project access and Railway Postgres, and owner approval per Rule 10); `news@{domain}` mail (now received through SES, D-MAIL-8, from Mail-2); owner review of About/Methods/Corrections copy; Privacy page (with the newsletter, M5).
- 2026-10-15 — **M2 Ingestion: complete in CI** (David0524/TownCore#10, #11, #12, #13, #14). Adapter framework with a polite Fetcher that enforces Rule 8 in code (never-scrape list, robots.txt, documented-API allowlist, ≤1 request/second per host, backoff on 429), recorded fixtures, ingest with dedupe/change tracking, per-source schedules, `source_runs` and health (ok/degraded/broken). Adapters: `nws` (federal), `civicplus` (calendar iCal + News Flash; every CivicEngage city), `fl-dbpr` (Florida contractor and electrician licenses), `fl-sunbiz` (Florida daily corporate filings). Boca has five verified live sources: council and public meetings (calendar), city releases, DBPR licenses, Sunbiz new filings, NWS FLZ168.
  - Open: YouTube meeting-video metadata needs `YOUTUBE_API_KEY` (YouTube Data API v3); DBPR real estate firms use a different file layout (M6); worker production deploy waits for Railway access.
- 2026-10-15 — **M3 Writer + fact-check + router: complete in CI** (David0524/TownCore#16, #17, #18, #19, and the follow-ups/evals PR). One model layer for Gemini (development) and Claude (production) with `ai_usage` logging, daily spend and call caps, and recorded-response replay; versioned prompts (classify, writer, fact-check, update). Story finder every 30 minutes: weekly roundups and NWS alerts built in code, classification, deterministic tier rules, newsworthiness 0–100 with stored components, daily budget with a public-safety cap, and a skip log. Writer → separate fact-check call → code checks (verbatim quotes, every name and number in a cited record, wrong-town) → one revise → tier router → published, review or blocked. Staff admin on the internal host: email-link sign-in, review queue (approve, edit with re-check, reject, minor-flag override), pending update notes, skip log with "write it anyway", audit log. Follow-ups: changed or matching records add dated update notes to published stories; dropped charges are always written; related stories are linked. Eval harness with 20 seed cases (7 real Boca releases, 13 synthetic safety cases), offline in CI.
  - Open: first live run on Boca (needs a session started after `GEMINI_API_KEY` was added); record eval responses (`pnpm evals --live`) so CI replays them; Resend and DNS for sign-in email (links print to the server log until then); placeholder reviewer "John" until a real name is set; showing related-story links on article pages (M4); the 50 hand-graded Boca stories (§12) once real drafts exist.
- 2026-10-15 — **First live M3 pass on Boca: partial, blocked on the model provider** (`docs/runs/2026-10-15-boca-m3-live.md`). All five sources ingested live and healthy (149 meetings, 3,381 DBPR licenses, 136 Sunbiz filings, 11 city releases, 15 NWS items). `pnpm stories:once boca-raton` (finder + writer once, same code path as the worker) published the two code-built Tier 1 roundups for Oct. 5–11 (101 new business filings, 3 new contractor licenses) on the draft site; 6 city releases skipped as thin; 5 wait for the model. Fixed from the run: DBPR "Construction Business Information" rows (no license number) were counted as licenses; roundups now say "with a Boca Raton mailing address" and note that such an address can be outside city limits (several Boca ZIPs, e.g. 33428, 33496, 33498, are mostly unincorporated). Model calls: first no key in the session, then Gemini HTTP 403 "Your project has been denied access" on every generation call (the key is valid; the Google project is blocked). AI cost $0; the failed calls are logged in `ai_usage`. A third attempt failed with HTTP 401 `API_KEY_SERVICE_BLOCKED`: the key that reaches Google is restricted away from the Generative Language API.
  - Fourth attempt: the Gemini key works. Live ingest and the story finder ran with model classification: 1 city release accepted, 6 skipped as thin, 4 below threshold. The writer and fact-check model (`gemini-flash-latest`) returned 503 for high demand, then 429: the free tier allows 20 requests a day for it. 0 articles written, 3 accepted candidates waiting, evals not run, cost $0.
  - **Fifth attempt: complete**, on `gemini-flash-lite-latest` for every role (owner's call). The story finder classified the 11 city releases (1 accepted, 6 thin, 4 below threshold); the writer published 3 stories on the draft site: the two roundups and "Boca Raton to Host 2nd Annual Mobility Workshop" (Tier 2, fact-check 1.0 on 11 claims, checked by hand). Live evals: 20/20 cases pass, 0 safety failures, fact-check pass rate 50%, 97% of quotes verbatim; responses recorded in `packages/prompts/evals/recorded/gemini.json` and replayed in CI. Cost $0.
  - Open: on Flash-Lite about half of written drafts go to review; revisit with Claude or a paid tier before launch.
- 2026-10-15 — **Mail-0 Setup: code complete in CI; acceptance waits on owner inputs** (David0524/TownCore#22, #23 and the infra PR). Plan and decisions D-MAIL-1 to 14; mail env vars; `teams`, `team_members`, `role_addresses` (one catch-all) with `pnpm mail:routing:sync` defaults; `packages/mail` recipient routing; deactivatable staff; `admin_actions` as the audit log; Google sign-in for `/admin` (PKCE, nonce, `hd` and HQ-domain checks, allow-list), with email links only while Google isn't configured; `packages/infra` CDK stack per environment (private encrypted bucket, SNS topics, two SES configuration sets with no open/click tracking, least-privilege app IAM user, operator onboarding policy), synthesized and tested in CI; `docs/mail/RUNBOOK.md` with the owner setup checklist.
  - Open (owner inputs in the runbook checklist): a Google OAuth client for towncore.net, so sign-in can be tested end to end; AWS account access to deploy the dev stack; SES production access; Vercel DNS token; test domains; DMARC address; postal address; staff list; mail retention; EU/Canadian subscribers.
- 2026-10-15 — **Mail-1 Domain onboarding: complete in CI; live test waits on owner inputs** (David0524/TownCore#24, #25 and the admin/worker PR). `pnpm mail:onboard add/status/retry/verify-all`: two SES identities per domain (root and `news.`, Easy DKIM, custom MAIL FROM, default configuration set), the 14 brief §7.1 DNS records on Vercel built from the SES response, conflict detection that never overwrites (a clashing MX/SPF/DMARC/CNAME fails that domain with nothing changed), resumable idempotent steps with a lease, dry-run by default (offline until credentials exist), and `--execute` limited to `MAIL_TEST_DOMAINS` unless `--approved`. The worker checks waiting domains every 5 minutes (read-only SES) and takes them live and warming at 50/day; Admin → Mail domains shows identities, records and steps with a re-check button. Company Google domain fixed as towncore.net.
  - Open: Vercel token, AWS access, a Google OAuth client and 3 test domains, so onboarding and sign-in can be run for real (then re-record the Vercel fixtures).
- 2026-10-15 — **Mail-2 Inbound pipeline: complete in CI; live test waits on owner inputs** (David0524/TownCore#29, #30 and the processor PR). Conversation tables (contacts, threads, messages, attachments, notes, mail_events); `/api/mail/sns` on the admin host verifies SNS signatures (v1/v2, SNS-host certificates, topic allow-list), confirms subscriptions and stores each notification once; the worker drains `mail_events` every 5 s with retries: fetch raw mail from S3, parse (mailparser), sanitize HTML, flag auto-replies, route each envelope recipient to its team (catch-all for unknown addresses, drop for domains not live), thread by In-Reply-To/References then contact + address + subject within 30 days, store attachments and inline images in S3, quarantine viruses, start spam in spam; redeliveries are no-ops. CDK adds the catch-all receipt rule (scan on, S3 + SNS) and activates it only with `-c receiving=true`.
  - Open: AWS access to deploy and send real test mail (Mail-2 acceptance: sales@/admin@/random@ routing, a threaded reply, attachments) once the owner provides AWS, Vercel and test domains.
- 2026-10-15 — **Mail-3 Inbox UI: complete in CI** (David0524/TownCore#34). `/admin/mail/inbox`: filters by status, team, town and assignee, search over contact, subject and town, per-person unread (`thread_reads`) with a count in the nav; thread view with messages in a sandboxed iframe (no scripts, own CSP, remote images blocked until "Load remote images", inline images via 15-minute signed URLs), attachments as 5-minute presigned S3 downloads (never for quarantined mail), assign, status, move team, spam / not spam and internal notes, all audited; keyboard `/`, `j`/`k`, `Enter`, `u`.
  - Open: try it on real mail once Mail-2 is live (AWS, test domains); email digest notifications later.
- 2026-10-15 — **Mail-4 Outbound replies: complete in CI** (David0524/TownCore#35 and the composer PR). Reply, reply all and new messages from any role address, with per-staff signatures; MIME built in code and sent raw through SES (conversational configuration set, domain and stream tags), or to the server log with `MAIL_TRANSPORT=log`; replies thread by our and SES's Message-IDs; attachments up to 10 MB stored in S3; suppressions (hard bounce, complaint, manual for every stream; unsubscribe for bulk only) with a "Send anyway" confirmation; SES sending events update each message's delivery status (forward only) and add suppressions; every send audited.
  - Open: live send test once SES production access is granted (runbook "First live check").
- 2026-10-15 — **M4 PR A + B: merged** (David0524/TownCore#33): robots.txt (draft towns disallow all), sitemap index, news sitemap, RSS, canonical tags, JSON-LD naming the site as publisher; `rankArticles()` with freshness, engagement, diversity and lead rules, staff and automatic pins, cookieless view and click counters.
- 2026-10-15 — **Mail-5 Newsletters and bulk: complete in CI** (David0524/TownCore#37, #39 and the admin PR). Town sites take signups once their mail domain can send bulk mail: plain-HTML form with honeypot and rate limits, double opt-in confirmed by a button (never a GET), consent evidence, a Privacy page (draft copy, publisher line), the footer unsubscribe page and RFC 8058 one-click unsubscribe. Bulk messages come from `newsletter@news.<domain>` with Reply-To `news@`, List-Unsubscribe headers, Feedback-ID, text part and a postal-address footer. Campaigns need an admin's "Approve send"; the daily newsletter needs a per-domain standing approval (D-MAIL-11); templates fan out per town; preview and test send. The worker sends in throttled batches that never send a row twice, defers over the warm-up cap, steps the warm-up ramp daily and auto-pauses bulk per domain (3% bounces / 0.08% complaints) or for every town (4% / 0.08%). SES events feed per-send status, subscriber status and `domain_health_daily`. Admin: subscribers (search, CSV export, unsubscribe), campaigns, bulk status, unpause. `pnpm mail:import` is a dry run until an admin approves.
  - Open: live sending needs SES production access and the postal address; the owner reviews the Privacy copy and decides on EU/Canadian signups (GDPR/CASL flagged in `docs/plans/MAIL.md`); M5 builds the daily issue and hands it to `scheduleNewsletterIssue`.
- 2026-10-15 — **M5 Newsletter: complete in CI** (David0524/TownCore#43 and the schedule and admin PRs; plan `docs/plans/M5.md`). Signup, double opt-in and unsubscribe come from Mail-5. The daily issue: weather from the NWS forecast with live alerts first, 5–8 new stories in homepage rank order (one civic item when one exists, public safety at its 20% share), public meetings in the next 7 days, corrections, at most one paid unit (top if sold, else mid; house ad otherwise), the AI-assisted disclosure, `?ref=newsletter` links, email-safe HTML and plain text with a factual subject. The worker builds each town's issue once per local date after its send time, skips thin days (fewer than 3 stories and no alert) without losing those stories, and gives up 3 hours late. Admin → Newsletter: test list, next-issue preview and test send, past issues with stats, and off → test → live (live needs an admin and 3 test issues sent, and is the D-MAIL-11 standing approval).
  - Open: real sending needs SES production access, AWS access and the postal address; pick Boca's test list; an events source for "Coming up" beyond meetings (later).
- 2026-10-15 — **Mail-6 Monitoring and operations: complete in CI** (David0524/TownCore#48 and the DMARC and removal PRs). Admin → Mail health answers "is anything on fire?": open alerts first (and a stale-worker warning), the SES account (enforcement status from `GetAccount` every 15 minutes, production access, quota, 7-day rates beside SES's review levels), every domain per stream, the event pipeline and DMARC. Alerts (paused bulk mail, SES not HEALTHY, account rates near review levels, failed onboarding, failed mail events) open and resolve themselves and are emailed to active admins from alerts@towncore.net, daily while open; code refuses recipients outside towncore.net. DMARC aggregate reports sent to `DMARC_REPORT_ADDRESS` are parsed (zip, gzip or XML; size-capped) into `dmarc_reports` with pass rates and failing sources. `pnpm mail:onboard remove` deletes only the DNS records and SES identities we created (dry run by default, `--approved` outside test domains) and marks the domain removed. The runbook covers onboarding, unpausing, an SES account review, credential rotation, Railway backups and restore, and removing a domain.
  - Open (owner): verify towncore.net in SES so alert emails send; set `DMARC_REPORT_ADDRESS` (recommended dmarc@bocatownsquare.com); turn on Railway volume backups, PITR and a nightly dump before real subscribers; the live tests for Mail-1 to Mail-6 still need AWS, Vercel and SES production access.
- 2026-10-16 — **M4 Publishing + SEO: built in CI; three live items open** (David0524/TownCore#33, the M4b redesign PRs #42–#54, #56, #57, #60, #62, #64 and the guides PR). Town-site redesign with three families (Boca `coastal-modern`, Harbor Point `heritage`, Pine Hollow `community`), Apple-native phone chrome, Today tiles with Boca's beach panels; the image router with typographic cards, data graphics from a story's own records and block-level OpenStreetMap maps, plus 1200×630 share images; entities and `/topics` pages (noindex under 3 stories) with related coverage; evergreen guides with `/guides`, the `essentials` module and Boca's 30 topics written live (`docs/runs/2026-10-16-boca-guides-live.md`).
  - Open: a reviewer approves Boca's first 30 guides in `/admin/review` (14 passed every check, 14 failed one, 2 blocked by the minor rule); Boca's base map needs `download.geofabrik.de` allowed in this environment's network settings (then check Geofabrik's robots.txt and terms and run `pnpm maps:once boca-raton`); a live check of the Boca draft site once it's deployed (Rule 10).
- 2026-10-16 — **M6 Directory, slots + Stripe: complete in CI** (David0524/TownCore#53, #55, #58, #59, #61, #63, #65 and the F PR; plan `docs/plans/M6.md`, runbook `docs/directory/RUNBOOK.md`). Listings seeded daily from DBPR licenses (contractors, trades, restaurants), active only, no street address until claimed, geocoded in or out of city limits; a live run on Boca seeded 1,979 active listings in 12 categories. Directory home, category and business pages with search, LocalBusiness data, the directory slots and house ads; beat-matched related businesses on articles; homepage modules. Claim flow with email confirmation and staff approval, owner portal by email link, Admin → Directory. Stripe in test mode (live keys refused): price sync, Checkout, verified idempotent webhooks, placements with inventory caps and held overflow, the Customer Portal; owners' sponsor cards become `campaigns` rows after staff approval. Quote requests to claimed, paying businesses and call taps log to `leads`; a cookieless beacon fills `slot_stats_daily`; monthly proof reports in the portal and by email. Outreach drafts from story mentions, sent only by staff. Ad standards on directory pages: labels, reserved heights, no overflow, CLS and phone ad density on every directory page (short category lists drop their unsold house ads on phones, see Decisions).
  - Open (owner inputs): Stripe test keys and a test webhook endpoint, to run Checkout against real Stripe test mode (CI uses signed, recorded events); live mode only on your say-so (runbook "Going live"); prices for category exclusive and newsletter sponsorship; claim, lead and report emails need SES sending like the rest of mail.
- 2026-10-16 — **Meeting platforms: Legistar and CivicClerk adapters merged** (David0524/TownCore#73; survey and build order `docs/plans/meeting-platforms.md`). Of 27 Palm Beach and Broward cities, 9 use Legistar (Delray Beach among them) and 9 CivicClerk; Boca Raton and Boynton Beach are Granicus-only, which robots.txt puts off-limits. Both adapters use the platforms' public APIs, never robots-blocked document hosts; each meeting becomes `meeting`, `agenda` and `meeting-actions`/`minutes` records, and the story finder writes minutes and recorded actions up as recaps. The Fetcher now checks robots.txt on every redirect hop.
  - Open (owner): Swagit meeting transcripts (Jupiter, Parkland) would give recap text but D-M2-4 keeps meeting video to metadata, so they wait for a decision; YouTube meeting-video metadata still needs `YOUTUBE_API_KEY`.
- 2026-10-16 — **M7 Launcher: built in CI; Delray dry run done, but Delray fails Rule 7** (David0524/TownCore#69, #70, #72, #74 and the E and F PRs; plan `docs/plans/M7.md`, run `docs/runs/2026-10-16-delray-dry-run.md`). `pnpm towns:rank` ranks a state's places from Census bulk files; Admin → Launches approves candidates. `pnpm launch "Town, ST"` runs nine resumable steps, all dry run by default:
  - resolve (Census, NWS zone, tier, same-name places);
  - names and domains (rotating patterns, the 50-mile neighbor rule, Vercel search, RDAP, archive history, official-word and outlet checks; buying needs `--approve-spend`, a typed confirmation and `expectedPrice`);
  - discovery (model web search when an Anthropic key exists, `--source` flags, state sources; every URL fetched under Rule 8 and matched to an adapter);
  - adapter requests;
  - readiness (30 days ingested, real items a day, Rule 7 stop);
  - seeding through the normal pipeline and the directory;
  - the theme (model or deterministic, built from the family presets, contrast fixed in OKLCH, content-volume, slot and neighbor rules in code, three masthead styles, identity assets, phone and desktop screenshots, a screenshot review with image input);
  - provisioning plan;
  - `launch-report.md` and `docs/launch-friction.md`.
  Admin → Launches lists runs and takes a ready town live (admin only, every check re-run, domain bought, mail domain live) or pauses it, tested on a fixture town.
  - Delray: report with a community-family theme and screenshots clearly different from Boca's; every check passes except readiness (0.2 items a day): `www.delraybeachfl.gov` refuses our bot (HTTP 403), so only state sources count. The milestone's "passing report" needs a readable town: the owner picks Delray sources or another town.
  - Open (owner): approve a town in Admin → Launches; an Anthropic key for discovery and identity research; registrant contact and a Vercel token before any purchase; the Census Data API key isn't needed (bulk files).
- 2026-10-16 — **M8 Ops: complete in CI** (plan `docs/plans/M8.md`, written and built overnight; decisions D-M8-1 to 5 took the recommendations).
  - **Admin → Health:** every town's items a day, fact-check pass rate, review queue, corrections, source health, AI spend and cost per story, subscribers and paying businesses, with the open alerts first.
  - **Alerts:** broken sources (critical for live towns), a town at its daily AI cap, cost per published story up more than 50% week over week, stories waiting over 24 hours in review, a silent worker and the network cap now share the mail alert table and emails ("TownCore alerts").
  - **Spend caps:** a network-wide AI cap of $50 a day beside each town's.
  - **Evals:** CI replays and must match the committed baseline; `pnpm evals --live` refuses to save a recording that lowers the fact-check pass rate or raises unsupported claims or safety failures, unless `--accept-regression "<reason>"`.
  - Also in this PR: Legistar and CivicClerk `propose()` for launcher discovery; readiness counts meeting recaps like the story finder; the Delray re-run with its Legistar meetings (0.53 items a day, still short of Rule 7).
- 2026-10-16 — **M9 Contributors and images: complete in CI** (plan `docs/plans/M9.md`; D-M9-1 to 5 above).
  - **Reader photos:** `/photos` on every town site (linked from About): a plain form with the license grant, credit line, honeypot and an hourly limit. Uploads are re-encoded to JPEG with all metadata stripped, kept privately, and served from the town's own domain at `/photos/<id>.jpg` only once approved.
  - **Business photos:** owners add up to 5 in the owner portal under a business license grant; approved ones show on the business page.
  - **Admin → Photos:** staff approve with alt text or reject; audited.
  - **Image router:** approved reader photos fill weather and community stories (never twice in a week, captioned "Reader photo: …" with the credit), a business's own photo fills a story about that one business, and an approved AI illustration fills its guide, labeled "Illustration (AI-generated)" and recorded as AI-generated with its approver.
  - **AI illustrations:** the `IllustrationProvider` path, prompt and review queue are built; no provider is configured (D-M9-4).
  - Open (owner): pick an illustration provider, or leave guides on stock photos and cards; AWS access so photos move to S3 (until then they're kept on the web server's disk, which doesn't survive a Vercel deploy, so don't open the photo form on a live town before S3); review the license wording.
- All milestones M0–M9 are built and green in CI. What remains needs the owner: the inputs listed under each milestone above (Anthropic key, AWS, SES production access, Vercel tokens, Stripe test keys, the registrant contact), approving a town for launch (Delray's dry run fell short of Rule 7), and production deploys (Rule 10).
