# Google safety (owner direction, 2026-10-17)

A Google manual action or spam demotion across the network would be catastrophic, so this is the
top priority as we scale to every town. Google's spam policies call out **scaled content abuse**:
many pages, often AI-written, that add little value, including content spread across many sites
to hide that scale. Our defense is pages with real value, honesty about who publishes them, slow
cohort rollout and a fast kill switch.

## Built (this PR)

| Area | What the code does |
| --- | --- |
| Thin pages are noindex (`apps/web/src/lib/indexing.ts`) | <ul><li>Section fronts, `/news` and the homepage need 3 real stories (the same bar as topic pages), else noindex, follow. The sitemap lists only the sections and homepage that pass.</li><li>`/events`, `/sports` and `/guides` are noindex while empty; `/guides` leaves the sitemap until a guide exists.</li><li>Weather, sections, newsletter, advertise, photos and the directory add and claim forms are always noindex.</li></ul> |
| Already in place | <ul><li>Topics need 3+ stories.</li><li>Directory categories need 5+ listings, and unclaimed listings are noindex.</li><li>Search is noindex.</li><li>Draft and paused towns are noindex everywhere.</li></ul> |
| Canonicals | Added to Methods, Corrections and every section front. |
| Transparency | <ul><li>About's `NewsMediaOrganization` names TownCore as `parentOrganization`.</li><li>Every article's `publisher` points to that organization by `@id`, so search engines can connect every story to its publisher. TownCore stays off every visible page except About and Privacy (Rule 1).</li><li>Every article links "How we report" (Methods) beside "Report an error".</li></ul> |
| Kill switch | <ul><li>`towns.search_hidden` takes a live town out of search: noindex on every page, robots.txt disallows all, sitemaps and feeds empty. Readers still reach the site.</li><li>`towns.cohort` is the month a town went live, set on go-live.</li><li>Admin → Health hides or shows one town, or a whole cohort, in one step. Admins only, logged with the reason.</li></ul> |

## Cohort rollout

1. **Cohort 1: tens of towns.** Search Console verified on every domain before go-live (manual launch to-do, D-M4-6), sitemaps submitted.
2. **Watch each cohort for 2–4 weeks in Search Console:**
   - pages indexed vs. submitted;
   - impressions and clicks;
   - Manual actions;
   - the Pages report's "Crawled – currently not indexed" and "Duplicate" counts.

   Compare against Boca and against the previous cohort.
3. **Grow the next cohort** (e.g. 2×) only when the last one indexes healthily:
   - most submitted article pages indexed;
   - impressions growing;
   - no manual action.
4. **Any manual action, or a cohort whose indexing collapses:**
   - hide that cohort from search with the kill switch;
   - stop launching;
   - fix the cause;
   - file a reconsideration request where Google asks for one.

## Still to do

- **Near-duplicates across towns.** Roundups and guides share templated sentences. Audit the
  templates and keep the fixed text to a minimum: each item should lead with the town's own
  specifics (names, addresses, figures). Add a CI check that compares two towns' roundups for
  shared text.
- **Search Console per domain.** Verification is a manual launch to-do today. Automate it when a
  Google API credential exists (the owner's call).
- **Own the audience.** The newsletter is the moat: push sign-ups (above the fold on phones
  already), Facebook pages and direct traffic, so search is never the only channel. Track each
  town's subscribers per 1,000 households on Admin → Health.
- **Keep:**
  - expired-domain checks (§10b);
  - no cross-site links;
  - never copying other outlets (Rule 3);
  - quality evals in CI (§12);
  - ad standards (§11b).
