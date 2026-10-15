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

1. Resolve town (census ID, county, boundaries, same-name towns).
2. Domain: check availability via registrar API; buy only with `--approve-spend`; set Cloudflare DNS; attach to hosting.
3. Discover sources (agent with web access): city site, agenda platform, meeting video, police/fire news, school district, county property/permits, NWS zone. Identify platform for each.
4. Match adapters via `detect()`; for unknown platforms, generate a new adapter + fixtures + tests on a branch for human review.
5. Readiness: pull last 30 days from all sources; score expected real items/day. Must reach ≥ 3/day (≥ 10 for `large`) or launch stops.
6. Seed: 30 evergreen guides, recent meeting recaps, business-openings backlog, directory from state license data — all through the normal pipeline.
7. Provision: newsletter list + forms, Stripe prices for the tier, analytics, sitemaps.
8. Write `launch-report.md`: sources, adapter coverage, readiness, 5 sample stories, failures, manual to-dos (Facebook page, Google Publisher Center).
9. Set town `status: draft`. A human approves in `/admin/launches` → `live`, schedules start.

Log every manual fix needed during a launch to `docs/launch-friction.md`; the goal is to drive that list to zero.

---

## 11. Sites, newsletter, directory

**Site pages:** home (latest + top stories), article, beat pages, events calendar, directory (category + business pages), newsletter signup, About, Methods, Corrections, network About, Report-an-error form on every article. Fast pages, mobile first.

**SEO:** NewsArticle + Organization structured data on articles, LocalBusiness on directory pages, XML sitemap + Google News sitemap per domain, canonical URLs, RSS, Open Graph images, accurate published/updated dates.

**Brand tokens (network defaults; towns may override name and logo only):**
`--navy #16233A` primary · `--brick #C2461F` accent/buttons (white text OK) · `--teal #1F8A8A` rare accent · `--paper #F6F1E7` background · `--slate #5B6475` body text. Serif headlines (Source Serif or Fraunces), Inter for UI. Never brick text on navy.

**Newsletter:** daily at the town's send time: weather, 5–8 items, events, one labeled sponsor slot. Double opt-in, one-click unsubscribe, physical address footer.

**Directory:**
- Seed from state license data (Florida DBPR to start) and other public business data; mark `license_verified`.
- Claim flow by email verification. Owners edit hours, photos, links.
- Products via Stripe Checkout: enhanced listing, sponsored slot (max 3 per category per town), newsletter sponsorship. All paid placements render a "Sponsored" label.
- Organic sort: verified license, completeness, recency of updates.
- Business triggers: when a published story mentions a new business opening or a business with a listing, queue an outreach email draft for human approval (never auto-send in v1).
- Monthly proof report per listed business: views, clicks, calls.

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
| M1 | Multi-tenant site | BocaTownSquare.com renders by hostname with brand, About, Methods, Corrections, network badge, a test article |
| M2 | Ingestion | Adapter framework + NWS, Boca agenda/meeting source, Florida business filings or licenses; scheduled; health tracked |
| M3 | Writer + fact-check + router | Candidates become articles; tiers enforced; `/admin/review` approve/edit/reject works |
| M4 | Publishing + SEO | Articles live with sources shown, sitemaps, news sitemap, structured data, RSS, 30 evergreen guides |
| M5 | Newsletter | Signup, double opt-in, daily issue built and sent (test list first), unsubscribe |
| M6 | Directory + Stripe | Seeded directory, claim flow, checkout for a sponsored slot, labels, webhooks |
| M7 | Launcher | `pnpm launch "Delray Beach, FL"` produces a passing launch report in dry-run, then live after approval |
| M8 | Ops | Health dashboard, spend caps, adapter-failure alerts, evals in CI |

Target: M0–M5 in the first 1–3 days; M6–M8 in week 1.

---

## 14. Working agreements for Claude Code

- Plan before code on every milestone; keep PRs small and focused.
- Ask before adding a new paid service, changing the stack, or weakening any rule in Section 2.
- Run tests before declaring anything done. Never mark a milestone done without its "Done when" being true.
- When unsure about a fact (a city's platform, a URL, an API's behavior), check it — do not guess.
- Keep this file current: decisions go in **Decisions**, progress in **Status**.

### Environment variables (keep `.env.example` in sync)
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `EMAIL_PROVIDER_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLOUDFLARE_API_TOKEN`, `REGISTRAR_API_KEY`, `HOSTING_API_TOKEN`, `APP_BASE_URL`, `ADMIN_EMAILS`

---

## Decisions
- (log decisions here with date and reason)

## Status
- Not started.
