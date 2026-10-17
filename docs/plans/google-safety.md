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

## Near-duplicates: built

**Measure.** The same template is built for two towns with different records. Both texts are
normalized: lowercase, town and agency names masked, numbers become `#`, link targets and
punctuation dropped. They're cut into 8-word shingles. The score is the shared shingles over
the smaller text's shingles. `NEAR_DUP_MAX` is 0.3 and `NEAR_DUP_SHINGLE_WORDS` is 8, both in
`packages/config/src/editorial.ts`. `packages/pipeline/test/near-duplicate.test.ts` checks every
code-built template in CI: meetings, new businesses, new licenses, new places, inspections,
permits, property sales and weather alerts.

**Roundups lead with the town's own facts.** Before the rewrite, two towns shared 49–77% of
each roundup; now every one is under 30%.

| Roundup | Now leads with |
| --- | --- |
| Meetings | The count, the first meeting and the busiest day |
| New businesses | The first names, the mix by type and the top ZIP |
| New licenses | The trades |
| New places | The first places and the mix |
| Inspections | Closures and complaints, or the most-cited place |
| Permits | The largest permit and the leading type |
| Sales | The top address and price, the median and the mix |

**Comparisons with the town's own past weeks.** Each roundup compares itself with the town's
own past: "up from 12 the week before", and "the most in 5 weeks" once there are 3 or more
past weeks.
- `packages/pipeline/src/roundup-weeks.ts` holds the record selection the finder uses, so the
  past weeks count exactly what the roundup counts.
- Weeks before the town's first record of that kind are skipped, so a week with no data never
  reads as zero.
- Caveats are short ("Filings aren't openings.", "Addresses can be outside city limits."), and
  nothing is added to fill space (Rule 7).

**Site copy.**
- Methods opens with "What we read for {town}": the town's own sources and its story count.
- Privacy is the same policy on every site by design, so it's `noindex, follow`.
- Corrections is `noindex, follow` and left out of the sitemap until it lists a correction.

**Audited and left shared by design.**
- The guide prompt already writes only from the town's official pages.
- About lists the town's sources by section.
- House ads, the newsletter frame and empty states don't use the article template.
- The Methods process steps and the guide note are the same everywhere on purpose: they
  describe one process.

## Still to do

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
