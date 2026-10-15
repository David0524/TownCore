# CLAUDE.md — TownCore

Read this whole file before doing anything. It is the source of truth for what we are building, the rules that cannot be broken, and the order of work. Update the **Status** section at the bottom at the end of every milestone.

---

## 1. What we are building

TownCore runs a network of AI-written local news sites, one per town, each with its own local brand (first site: **Boca Town Square**, BocaTownSquare.com). Each site has:

- A news site written from **primary public sources** (council agendas and meeting video, permits, property sales, business filings, inspections, official police/fire releases, weather, events).
- A **free daily email newsletter** (the core retention product).
- A **local business directory** that sells labeled sponsored slots, leads and newsletter sponsorships.

The long-term goal is thousands of towns. The core system goal: **launching a new town = buy a domain + run one command**, with about 15 minutes of human review.

TownCore is the corporate/internal name. Consumer brands are local, but every site discloses that it is part of the **TownCore Local network** (see rules).

---

## 2. Non-negotiable rules

These protect us from Google spam actions, lawsuits and press exposés. Code must enforce them; do not rely on prompts alone.

1. **Disclose the network.** Every site footer shows a "Part of the TownCore Local network" badge linking to a network About page naming the company and a contact email. Every site has an About page, a Methods page (how AI writes and how stories are checked), and a Corrections page.
2. **Honest bylines.** Byline format: `{Site Name} Newsroom (AI-assisted)`. If a human reviewed or edited it, add `Reviewed by {name}`.
3. **Primary sources only.** Stories are written from source documents and records. Never rewrite another news outlet's article. Other outlets may appear only as: headline + one-line summary in our own words + link out.
4. **Every claim is sourced.** Every published article stores and displays links to the source records it was written from.
5. **Risk tiers gate publishing** (Section 7). Tier 3 never auto-publishes. Tier 4 is blocked in code.
6. **Paid placement is always labeled "Sponsored."** Organic directory order is never affected by payment.
7. **No thin towns.** A town cannot go live unless its readiness score passes (Section 10).
8. **Scraping etiquette.** Respect robots.txt and site terms. Max 1 request/second per host. User-Agent: `TownCoreBot/1.0 (+https://towncore.net/bot; contact@towncore.net)`. Never scrape Google Maps, Yelp, Facebook, Nextdoor, or paid sports databases.
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
| Email | A transactional/bulk provider with an API (Resend or Amazon SES — pick one, abstract behind `packages/email`) |
| Payments | Stripe (Checkout + Billing + webhooks) |
| DNS/CDN | Cloudflare |
| Hosting | Web on Vercel (multi-domain); worker on Railway or Fly. Keep infra choices behind small interfaces |
| Staff auth | Email magic link, staff-only admin at `/admin` |
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
  directory/      # listings, seeding, claim flow, Stripe products
  config/         # town config schema (zod) + loader
towns/            # one YAML config per town, e.g. towns/fl/boca-raton.yaml
docs/plans/       # milestone plans written before coding
```

---

## 5. Data model (starting point)

- `towns` — id, slug, name, state, census_id, county, timezone, domain, site_name, status (`draft|live|paused`), tier (`small|mid|large`), config (jsonb), readiness_score
- `sources` — id, town_id, kind (`agenda|meeting_video|permits|property_sales|business_filings|inspections|police|fire|schools|weather|events|other_outlet`), platform, url, adapter, schedule, health (`ok|degraded|broken`), last_ok_at
- `records` — id, source_id, town_id, external_id, type, title, text, url, occurred_at, raw (jsonb), content_hash; unique(source_id, external_id)
- `story_candidates` — id, town_id, record_ids[], beat, proposed_tier, newsworthiness, status
- `articles` — id, town_id, slug, headline, dek, body_md, beat, tier, status (`draft|in_review|published|rejected|blocked|corrected`), byline, reviewer_id, source_record_ids[], claims (jsonb), factcheck (jsonb), published_at, updated_at
- `corrections` — id, article_id, note, created_at (shown publicly)
- `businesses` — id, town_id, name, category, address, phone, website, license_type, license_number, license_verified, data_source, claimed_by_email, claimed_at
- `placements` — id, business_id, town_id, product (`enhanced|sponsored_slot|exclusive|newsletter|spotlight`), category, stripe_subscription_id, starts_at, ends_at, status
- `leads` — id, business_id, kind (`call|form`), meta, created_at
- `subscribers` — id, town_id, email, status, consent_at, source
- `newsletter_issues` — id, town_id, date, article_ids[], sponsor_placement_id, sent_at, stats
- `ai_usage` — id, town_id, job, model, input_tokens, output_tokens, est_cost_usd, created_at
- `staff` — id, email, name, role (`admin|reviewer`)
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

- Routine extraction, classification, templated items: `claude-haiku-5-5`
- Writer and fact-check: `claude-sonnet-5-5`
- Launcher source discovery and writing new adapters: `claude-opus-5-5`

Verify current model names and pricing in the Anthropic docs before hardcoding; keep them in one config file. Log every call to `ai_usage`. Enforce a per-town daily spend cap (config) and alert when cost per published article rises more than 50% week over week. Keep the pipeline model-agnostic behind `packages/pipeline/llm.ts`.

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
pricing: { sponsored_slot_usd: 199, enhanced_usd: 39 }
```

**Launcher CLI:** `pnpm launch "Delray Beach, FL" --domain delraytownsquare.com [--dry-run (default)] [--approve-spend]`

**Before step 1:** the town must come from an approved row of the Section 10a ranking.

1. Resolve town (census ID, county, boundaries, same-name towns).
2. Propose 3 names and domains (Section 10b), run the conflict checks, check availability, and buy the chosen domain only with `--approve-spend` after the human picks.
3. Discover sources (agent with web access): city site, agenda platform, meeting video, police/fire news, school district, county property/permits, NWS zone. Identify platform for each.
4. Match adapters via `detect()`; for unknown platforms, generate a new adapter + fixtures + tests on a branch for human review.
5. Readiness: pull last 30 days from all sources; score expected real items/day. Must reach ≥ 3/day (≥ 10 for `large`) or launch stops.
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

**Hard filters:** population of at least 5,000, and a source readiness score that passes Rule 7. Never launch a town without a human approving it from the ranked list.

---

## 10b. Site names, domains and logos

**Naming.** The launcher proposes 3 names per town, each with domain and conflict checks, and the human picks one in the launch report.

- **Patterns** (rotate them; don't use one pattern network-wide): `{Town} Town Square`, `The {Town} Ledger`, `{Town} Daily`, `{Town} Local`, `The {Nickname} Post` (e.g. a well-known local nickname), `{Town} Courier`.
- **Rules:**
  - Short, easy to say aloud, `.com` preferred, no hyphens or numbers.
  - Matching social handles available, or close to it.
  - The neighbor rule applies: towns within 50 miles use different patterns.
- **Conflict checks (block the name if any fail):**
  - It matches or closely resembles a current local outlet, a defunct local newspaper, or a registered trademark (USPTO search).
  - It sounds official: "City of", "Official", "Gov", or a government department name.
  - The domain is an **expired domain** previously used by a news site. Google's spam policies call this "expired domain abuse." Check archive history before buying.

**Logos and identity assets** (all generated in code from the theme; no image model):
- **Masthead:** an SVG wordmark from the name, type pairing and motif. The launcher renders 3 variants and the human picks one.
- **Motif library:** `packages/brand/motifs/`, simple single-color SVG icons such as palm frond, lighthouse, pine, mountain ridge, river, bridge, clock tower, water tower, citrus, sailboat, oak and grain elevator. The theme agent picks one that fits the town's identity notes. Add new motifs by human review only.
- **Derived assets:** favicon, app icon, social avatar, Open Graph default image, newsletter header, and the Facebook cover image (1640×624 or the current recommended size).

---

## 11. Sites, newsletter, directory

**Site pages:** home (latest + top stories), article, beat pages, events calendar, directory (category + business pages), newsletter signup, About, Methods, Corrections, network About, Report-an-error form on every article. Fast pages, mobile first.

**SEO:** NewsArticle + Organization structured data on articles, LocalBusiness on directory pages, XML sitemap + Google News sitemap per domain, canonical URLs, RSS, Open Graph images, accurate published/updated dates.

**TownCore network brand** (network About page, footer badge, admin only, NOT the town sites' look): `--navy #16233A` · `--brick #C2461F` (white text OK) · `--teal #1F8A8A` · `--paper #F6F1E7` · `--slate #5B6475`. Never brick text on navy. Town sites get their own themes (Section 11a).

**Newsletter:** daily at the town's send time: weather, 5–8 items, events, one labeled sponsor slot. Double opt-in, one-click unsubscribe, physical address footer.

**Directory:**
- Seed from state license data (Florida DBPR to start) and other public business data; mark `license_verified`.
- Claim flow by email verification. Owners edit hours, photos, links.
- Products via Stripe Checkout: enhanced listing, sponsored slot (max 3 per category per town), newsletter sponsorship. All paid placements render a "Sponsored" label.
- Organic sort: verified license, completeness, recency of updates.
- Business triggers: when a published story mentions a new business opening or a business with a listing, queue an outreach email draft for human approval (never auto-send in v1).
- Monthly proof report per listed business: views, clicks, calls.

---

## 11a. Web design system (one system, a distinct look per town)

Every town runs the same components and page templates, but each gets its own theme so it feels like *that town's* paper. Variation is for local character and reader trust, never to hide the network: Rule 1 disclosure applies to every theme.

**Architecture**
- One component library in `apps/web/components` driven entirely by CSS custom properties. No component may hardcode a color, font or radius.
- A town theme is a file: `towns/fl/boca-raton.theme.json`, validated by zod.
- A theme has two halves: **look** (palette, type pairing, corner style, local motif, masthead style) and **layout** (how every page is assembled, Section 11a-2). Both vary per town.

**Theme schema (example: Boca Town Square)**
```json
{
  "palette": {
    "ink": "#0E4A6B",
    "accent": "#3E7A4C",
    "accentText": "#FFFFFF",
    "tint": "#F2C9C4",
    "surface": "#F2F6F8",
    "background": "#FFFFFF"
  },
  "type": "newsreader-publicsans",
  "masthead": "centered-serif",
  "layout": {
    "header": "stacked-dateline",
    "nav": "beat-tabs",
    "grid": "main-right-rail",
    "home": ["lead-story", "latest-list", "meetings-this-week", "directory-featured", "beat-sections", "events", "new-businesses", "real-estate"],
    "article": "classic-rail",
    "directory": "list-map",
    "footer": "three-column"
  },
  "corners": "soft",
  "motif": "palm-frond",
  "identityNotes": "Atlantic blue, sea-grape green, Mizner-era pink stucco as a light tint only"
}
```

**Curated type pairings** (self-hosted Google Fonts; headline / body): Newsreader / Public Sans · Fraunces / Work Sans · Libre Caslon Text / Source Sans 3 · Literata / IBM Plex Sans · Bitter / Hanken Grotesk · Spectral / Karla. Add new pairs only by human decision.

### 11a-2. Layout system: every town assembled differently

Pages are composed from interchangeable parts, so towns differ in structure, not just color. The generator picks one option per part, under the constraints below.

| Part | Options (start with these; add more over time) |
| --- | --- |
| Header | `centered-masthead`, `left-logo-inline-nav`, `stacked-dateline` (masthead + date and weather bar), `compact` |
| Navigation | `beat-tabs`, `mega-menu`, `hamburger-only` (small towns), `bottom-bar` (mobile) |
| Grid | `single-column`, `main-right-rail`, `main-left-rail`, `split-two-column` |
| Homepage | An ordered list of modules from the module library (below), not a fixed template |
| Article page | `classic-rail`, `wide-reading` (no rail, generous measure), `magazine` (large lead image, pull-out source box) |
| Directory | `list-map`, `category-grid`, `search-first` |
| Footer | `three-column`, `minimal`, `community` (events and newsletter forward) |

**Homepage module library.** Each module is self-contained, declares the data it needs and the monetization slots it provides (Section 11b), and hides itself if it has nothing to show:

- **News modules:** `lead-story`, `latest-list`, `beat-sections`, `briefing-column` (newsletter-style dated list), `meetings-this-week`, `new-businesses`, `real-estate` (sales and permits).
- **Community modules:** `events`, `schools-sports`, `weather-strip`, `photo-of-the-day` (reader submissions, later).
- **Directory and money modules:** `directory-featured`, `directory-categories`, `jobs-classifieds` (later).
- **Signup module:** `newsletter-cta`.

**Generation constraints**
- **Content volume decides structure.** Towns with fewer than 5 items a day cannot use `lead-story` first or `split-two-column`; they lead with `briefing-column`, `events` or `directory-featured`, so small towns never look empty.
- **Required everywhere.** `newsletter-cta` appears in the first two modules on mobile. Every layout must satisfy the slot contract in Section 11b.
- **Neighbors look different.** Two towns within 50 miles may share at most two of: header, grid, article template, and the first three homepage modules.
- **Locked components.** Variation never touches disclosure, bylines, source links, the "Sponsored" label style or the network badge.

**Layouts are experiments.** Thousands of towns make a huge test bed. Assign module orders and templates as tracked experiments and measure newsletter signup rate, pages per visit, directory clicks and revenue per 1,000 visits. Spread winning patterns across the network, but keep the neighbor constraint so winners don't make every site identical.

**Masthead and logo:** generate each town's wordmark as SVG in code, from the town name, its type pairing and its motif. Do not use an image model for mastheads; they must be sharp, consistent and editable. Never use the city seal, official city logo or government colors in a way that suggests the site *is* the city government.

**Every page also includes**
- A newsletter signup above the fold on mobile.
- A weather strip.
- "Sponsored" labels styled visibly differently from editorial content, never disguised.
- Source links on every article.
- The network badge in the footer.

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
6. The generator enforces the neighbor rule in 11a-2 and avoids reusing a palette and type pairing within 50 miles. It also confirms the slot contract in 11b passes.

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

**Fill order for every slot:**
1. Direct-sold campaign.
2. Sponsored directory or local placement.
3. Programmatic ad (later; see below).
4. House ad: newsletter signup, "Claim your free listing", or "Advertise in {Site Name}".

Slots never render empty, and their height is reserved in advance so ads never shift the page (CLS budget).

**Ad standards (enforced in CI)**
- No pop-ups, interstitials, autoplay audio, or large sticky ads.
- Mobile ad density stays at or below 30% of an article's scroll height, following the Coalition for Better Ads standard.
- Every paid unit shows a "Sponsored" or "Advertisement" label in the locked label style.
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
| **AI-generated illustration** | Explainers, evergreen guides, generic features | Clearly illustrative style, never photorealistic news scenes; no real people, no real events, no identifiable real places presented as photos; label "Illustration (AI-generated)" |

**Never:**
- Images from other news sites, social media, Google Images or Street View.
- Mugshots.
- AI images of real people.
- A photo of a different place passed off as the story's location.

**Every image needs:** alt text written from what it actually shows, a credit line, and an `images` row: id, kind, source_url, license, attribution, ai_generated, approved_by.

**Defaults by beat** (stored in config; the first allowed option wins):
- Development, permits, property: map → data graphic → card
- Meetings: data graphic (votes) → government image → card
- Business openings: business photo → card
- Public safety: block-level map → card
- Weather: reader photo → stock → card
- Guides: AI illustration → stock → card

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
| M1 | Multi-tenant site + design system | Token-driven components; a layout system with at least 2 options per part and the homepage module library; the slot contract with house ads in every slot; the contrast checker; BocaTownSquare.com renders by hostname with its own theme, SVG masthead, About, Methods and Corrections pages, network badge and a test article; and a second dummy town with a different look AND layout proves nothing is hardcoded |
| M2 | Ingestion | Adapter framework + NWS, Boca agenda/meeting source, Florida business filings or licenses; scheduled; health tracked |
| M3 | Writer + fact-check + router | Candidates become articles; tiers enforced; `/admin/review` approve/edit/reject works; newsworthiness score, daily story budget, skip log and follow-up linking |
| M4 | Publishing + SEO | Articles live with sources shown, sitemaps, news sitemap, structured data, RSS, 30 evergreen guides; ranking (rank formula, pins, diversity rules), entity pages, the image router with maps, data graphics and typographic cards, and Open Graph images |
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

### Environment variables (keep `.env.example` in sync)
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `EMAIL_PROVIDER_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLOUDFLARE_API_TOKEN`, `REGISTRAR_API_KEY`, `HOSTING_API_TOKEN`, `APP_BASE_URL`, `ADMIN_EMAILS`, `DEV_TOWN_SLUG` (dev/preview only)

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

## Status
- 2026-10-15 — **M0 Scaffold: complete** (David0524/TownCore#1, #2, #3). Monorepo with pnpm + Turborepo; Postgres schema for all §5 tables with rule-enforcing CHECK constraints; town YAML config (Boca Raton, sources TBD); pg-boss worker with a per-minute heartbeat cron; CI runs format, lint, typecheck, migration drift check, tests against Postgres, build and a worker boot smoke test.
- Next: **M1 Multi-tenant site + design system**. Plan revised for UPDATE-01 in `docs/plans/M1.md`, waiting for approval.
