# Adapter fix routine (for a scheduled Claude Code session)

Instructions for a Claude Code session that picks up adapter fix requests and opens pull requests.
The worker opens the requests (`packages/adapters/src/fixes.ts`; docs/plans/agentic-ops.md §3).
Writing adapter code never happens in the pipeline: it is "writing a new adapter" in the model
routing table, done here, reviewed by a person.

No schedule exists yet. Creating one (for example, weekdays at 7 a.m. Eastern) is the owner's call.

## Before you start

1. Read `CLAUDE.md`. Section 2 is non-negotiable. Rule 8 matters most here:
   - respect robots.txt and site terms;
   - at most 1 request a second per host;
   - identify the bot;
   - never widen `DOCUMENTED_APIS` to get around robots.txt.
2. You need `DATABASE_URL` for the production database, read-only.
3. In a cloud session, set `NODE_USE_ENV_PROXY=1` so Node's fetch uses the proxy.

## 1. Pick the work

List the open requests in Admin → Fixes, or query `adapter_fix_requests` where `status = 'open'`.
Take them in this order:

1. **Platform patterns** (`scope = 'platform'`), most towns first. One fix in the platform's
   adapter heals every town on it. Never fix a platform pattern town by town.
2. Then single sources whose town is live, then draft towns.

Mark each request **In progress** in Admin → Fixes before you start, so two sessions don't take it.

## 2. Decide what kind of fix it is

Use the request's `failure`:

| failure | What to do |
| --- | --- |
| `robots`, `blocked` | Not an adapter bug. Never work around it (Rule 8). Look for another allowed official source for the same records (the discovery agent may have proposals). Otherwise dismiss the request with a note, and propose removing the source from the town YAML in a pull request. |
| `http_auth` (401, 403) | The site refuses our bot or now needs a key. Never change the User-Agent to look like a browser. Read the site's terms. If an official API with a key exists, describe it for the owner (a new key may be a new service, §14) and dismiss. |
| `http_gone` (404, 410) | The feed or page moved. Find the new official URL on the publisher's own site. If one town moved, change that town's YAML source. If the platform's URL pattern moved for every town, change the adapter. |
| `parse`, `empty` | The format changed. Compare the request's fixture with the adapter's recorded fixtures under `packages/adapters/test/fixtures/`, then update the parser. |
| `http_server`, `timeout`, `network`, `rate_limited` | Usually transient. Re-run the town's sources of that kind once (`pnpm ingest:once <town-slug> --kind <kind>`). If it works, dismiss with a note. If it lasts, look for a moved host. For `rate_limited`, lengthen the source's schedule; never raise the request rate. |
| `unknown` | Read the error and the fixture, then use the closest row above. |

## 3. Fix it on a branch

1. Create a branch, e.g. `fix/<platform>-<short-reason>`.
2. Save the request's fixture as a new test fixture under `packages/adapters/test/fixtures/`. It is
   the failing fetch, recorded through the polite Fetcher. Re-record the adapter's other fixtures
   against the live source if the format changed:
   `pnpm --filter @towncore/adapters fixtures:record <platform> <name> '<config>'` (through the
   same Fetcher and its Rule 8 checks).
3. Write a test that fails on the old code with the new fixture, then fix the adapter until it
   passes. Keep one adapter working for every town on its platform (CLAUDE.md §9).
4. Run the checks: the adapters tests, typecheck, lint and prettier.
5. Open a pull request. Its description should say:
   - the request id or ids, and for a platform pattern which towns it heals;
   - the diagnosis;
   - what changed and why;
   - which fixtures were re-recorded.
   End it with the attribution lines the session gives you.

## 4. Close the loop

- In Admin → Fixes, mark the request **Fixed** with the pull request's URL. Closing a platform
  request closes the town requests under it.
- After the merge and deploy, the next ingest marks the source healthy. If it breaks again, the
  worker opens a new request with a new fixture.
- Log anything you had to do by hand in `docs/launch-friction.md`, so it can be automated next.

## Never

- Change `DOCUMENTED_APIS`, the never-scrape list or the User-Agent to get a source working.
- Scrape a host or path robots.txt disallows, or Google Maps, Yelp, Facebook, Nextdoor or paid
  sports databases.
- Merge without CI green.
- Deploy to production; that stays a person's step (Rule 10).
