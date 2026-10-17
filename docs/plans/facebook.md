# Facebook and quick polls

Owner direction, 2026-10-17 ("build traffic and self-serve revenue"), items 3 and 5. Built once for
every town (CLAUDE.md §14).

## 1. Each town's Facebook page

Every town has its own page; it looks like an independent local paper's page, with no network
branding (Rule 1). Meta doesn't let apps create pages, so pages are made by hand, **one batch per
launch cohort**:

1. Create each town's page with the cover and avatar from the launch's `identity/` folder.
2. Add it to the town's YAML and run `pnpm towns:sync`:

   ```yaml
   facebook:
     url: https://www.facebook.com/delrayledger
     page_id: '123456789012345'
   ```

3. If staff will use the Post button, add the page's token to `META_PAGE_TOKENS` (below).

Admin → Facebook lists towns still missing a page. The launch report's manual to-dos and
`docs/launch-friction.md` carry the same step.

## 2. The daily queue

The worker (`social.facebook`, hourly) queues posts for every **live** town, from 10:00 town time:

- **Top stories:** up to 3 a town-local day, picked in homepage rank order (§6a: newsworthiness,
  freshness, engagement, pins, diversity) from stories published in the last 24 hours.
- **Weekly roundups:** new places to eat and drink, property sales and inspections roundups, when
  one is published (last 7 days).

Only published stories are queued, so a Tier 3 story appears only after a person approved it. Each
story is queued once, ever. Test stories are left out.

The post text is written from the story, nothing added: the headline, then the dek (or the first
sentence). The link is the story on the town's own domain with `?ref=facebook`. No clickbait, no
questions, no emoji, no padding; Facebook draws the link preview from the story's Open Graph tags.

## 3. Admin → Facebook

Today's batch for every town, grouped by cohort and county, so staff post every town in one pass.
For each post: **Copy post** (text and link), **Open page**, then **Mark as posted** or **Skip**.
Where a page has a token, **Post** sends it through the Graph API. Every press is in the audit log
(`facebook.mark_posted`, `facebook.skip`, `facebook.post`).

## 4. Graph API posting (off by default)

Posting to a page is an outward action (Rule 10): it happens only when a staff member presses Post.

- **Call:** `POST https://graph.facebook.com/v26.0/{page-id}/feed` with `message`, `link` and the
  page's `access_token` (form-encoded); the response is `{ "id": "{page-id}_{post-id}" }`, stored
  as the post's `external_id`. Checked against Meta's Pages API docs ("Posts" and the `/feed`
  edge) on 2026-10-17; the version is pinned in `META_GRAPH_VERSION` and should be re-checked
  against Meta's changelog before it's switched on. The live API has not been called.
- **Permissions:** a Page access token from a Meta app with `pages_manage_posts` (plus
  `pages_read_engagement` and `pages_show_list`), granted by someone with a task on the page.
  The link must be public, or Facebook refuses the post.
- **Tokens:** `META_PAGE_TOKENS` is a JSON object of page id to page token, in the environment only
  (Rule 11), never committed.
- **Switch:** `FACEBOOK_AUTOPOST` stays `off` (unset). Setting it to `on` lets the worker post each
  queued item itself; do that only on the owner's standing approval, recorded in CLAUDE.md
  Decisions.

## 5. Cluster audiences (docs only; no ad buying)

Towns launch in clusters (§10a cluster fit). When the owner decides to advertise on Meta, towns in
a cluster share audiences rather than each building its own:

- **One ad account per cluster** in the company Business Manager (owned by TownCore), with every
  town page in the cluster added to it. Pages stay independent in name and look.
- **Engagement custom audiences** ("people who engaged with any of these pages") can include
  several pages, so one audience covers the whole cluster.
- **Website audiences:** only if a Meta pixel is added, which the sites don't have (D-M4-3,
  first-party cookieless counters) and which would need its own privacy decision. Until then use
  page-engagement and lookalike audiences only.
- **Lookalikes** from the cluster's engagement audience, limited by location to the cluster's
  towns (a radius around each town, or the county).
- **Newsletter signups** are the goal for ads, not traffic: the morning email is what keeps readers.
  Uploading subscriber emails as a customer list needs the subscribers' consent terms to allow it;
  they don't today, so don't.

No ad spend without the owner's approval (Rule 10).

## 6. Quick polls

A `quick-poll` homepage module, in every family's defaults (coastal-modern and community in the
rail, heritage in the main column). Hidden when no approved poll is running.

- **Admin → Polls:** staff write a question and 2 to 4 answers, with a first and last day
  (town-local, at most 31 days). It's saved as a draft; a staff member approves it, and it shows
  from its first day. Withdraw takes it down. All audited (`poll.create`, `poll.approve`,
  `poll.withdraw`).
- **Content:** an opinion question about a local topic. Never about a named private person, a
  crime or anything a reader could be hurt by. Links and handles are refused in code; the rest is
  the approver's job.
- **Voting:** one vote per address per poll, stored as a keyed hash (HMAC-SHA256 with
  `VOTE_HASH_SECRET` of the poll id and the address), so no raw address is kept. The browser also
  remembers its vote (localStorage), so a returning reader sees the results. A honeypot field and
  a same-origin check, like the other reader forms.
- **Results** show after voting, as bars with the vote count, labeled "A reader poll, not a
  scientific survey". Without JavaScript the form lands on `/poll/{id}` with the results.
