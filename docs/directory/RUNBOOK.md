# Directory runbook (M6)

How to run the business directory: listings, claims, the paid side and outreach. Decisions:
`docs/plans/M6.md` (D-M6-1 to 11).

## Listings

- The worker rebuilds each town's listings from its state license records daily (09:20 UTC)
  and geocodes pending ones every 15 minutes (Census Geocoder). Only active state-licensed
  businesses are listed (D-M6-1); unclaimed listings never show a street address (D-M6-2).
- Listings with a town mailing address outside city limits read "{Town} area" (D-M6-3).

## Claims and owners (D-M6-4, D-M6-11)

- A claimant confirms their email address by link (expires in 7 days; at most one email per
  10 minutes and 3 a day per claim; 5 new claims an hour per IP). The claim then waits in
  Admin → Directory → **Claims waiting for a decision**.
- Approve only when the person, their role and their email fit the licensed business (check the
  license holder's name; a business email domain helps). Approving makes them the listing's
  one owner and emails a sign-in link. Every decision is audited.
- Owners sign in by email link (one use, 30 minutes); a session lasts 30 days. A new business
  name from an owner waits for staff approval in the same page.
- To change an owner: reject or let the old session expire, then approve a new claim. There is
  one owner email per listing.

## Sponsor cards (D-M6-7)

The owner of an active sponsored slot writes a card (headline up to 70 characters, text up to
160). It shows only after staff approve it in Admin → Directory → **Sponsor cards waiting**.
Reject anything inaccurate, not about the business itself, or with claims we can't stand behind
(superlatives like "best in town"); the note goes back to the owner. The "Sponsored" label is
added by code. A category never shows more than 3 cards; a card comes down with its placement.

## Stripe: test mode only (D-M6-5)

Code refuses live keys (`sk_live_…`, `rk_live_…`) and live-mode webhook events. Live payments
need the owner's explicit approval and a code change that lifts that guard, per environment.

### Set up test mode
1. In the Stripe dashboard (test mode), create a restricted or secret **test** key and set
   `STRIPE_SECRET_KEY` in the web app's environment.
2. Add a webhook endpoint at `https://<APP_BASE_URL host>/api/stripe/webhook` (the admin host;
   town sites have no webhook) for these events (`HANDLED_EVENTS` in
   `packages/directory/src/stripe/webhook.ts`; a test keeps this list in step with it):
   `checkout.session.completed`, `checkout.session.expired`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
3. Turn on the Customer Portal (Settings → Billing → Customer portal) with "cancel
   subscriptions" and "update payment methods".
4. Create the Products and Prices from each town's `pricing`:
   ```
   pnpm directory:stripe sync              # dry run: prints the plan
   pnpm directory:stripe sync --execute    # creates what's missing (test key only)
   ```
   It is idempotent (each Price has a lookup key `towncore:<town>:<product>:<cents>`). A changed
   price creates a new Price; existing subscribers stay on the old one until they change plan.
5. Check everything, read-only:
   ```
   pnpm directory:stripe check
   ```
   A checklist of the test-mode key, the account's name and id, the webhook endpoint (enabled,
   with every event above), `STRIPE_WEBHOOK_SECRET` (set or not; never printed), the default
   Customer Portal (cancel and card updates on) and the Products and Prices (nothing left for
   `sync` to create, and every recorded Price found in this account). It exits non-zero while
   anything is missing; a live key is refused as everywhere else.

### How a purchase works
- **The storefront, `/advertise`** on every town site: a category chooser (every category with
  listings, its listing count, how many featured spots are open and the from-price), the
  chosen category's spots #1–#3 with a **Get spot #n** button on each open one (Taken
  otherwise; when all three are sold, the waitlist), the category sponsorship beside them, and
  cards for the Enhanced listing, a morning-email week and a category month, each with
  **Get started**. House ads lead here.
- **`/advertise/start?product=…&category=…&rank=…`** checks the offer and shows what it is, where
  it shows, its current price and the trial when one applies. A signed-in owner sees their
  claimed listings that fit (for a category product, only those in the category), each with
  **Continue to secure checkout** (and a week or month to pick for a dated booking); it posts to
  the same `/owner/<slug>/checkout` as the owner page. A visitor gets a search for their
  business, each result linking to its claim page (free, with an email confirmation and an
  editor's check), **Add it** when it isn't listed, and **Sign in** when it's already claimed.
  A sold spot offers the other open ones or the waitlist; a booked week or month, the next open
  one. Not indexed.
- An owner of an approved claim can also buy from **Manage your listing** on the town site.
  Inventory is checked (featured spots: one business per spot and category; a started Checkout
  holds a place for an hour), then Stripe Checkout opens: subscription mode for spots and
  Enhanced, payment mode for a dated week or month at the current price.
- Checkout returns to the owner page: `?s=paid` says the placement turns on once Stripe confirms
  it, `?s=canceled` that nothing was charged.
- Only the verified webhook turns a placement on. A Checkout that completes after its category
  filled up is **held**: paid, never shown.
- Past-due subscriptions stay on while Stripe retries; when retries end (`unpaid`) or the
  subscription is canceled, the placement turns off.

### Refunds and held placements
Staff never charge a card. Refunds happen in the Stripe dashboard:
1. Admin → Directory → **Paid placements** lists held placements first.
2. Open the subscription in Stripe (the `sub_…` id shown), cancel it and refund the payment, or
   offer the business the next opening and leave it held until then.

### Webhook problems
- Stripe retries a failed delivery for up to 3 days. Each event is stored once in
  `stripe_events`; a replay of a processed event does nothing, so re-sending from the
  dashboard (Developers → Webhooks → the event → Resend) is always safe.
- An event that failed keeps its error in `stripe_events.error`. Fix the cause, then resend it
  from the dashboard.
- A 400 from `/api/stripe/webhook` means a bad signature: check `STRIPE_WEBHOOK_SECRET` matches
  the endpoint's signing secret (each endpoint has its own).

### Going live (needs the owner's approval, D-M6-5)
1. The owner says so, for a named environment.
2. Lift the live-key guard in `packages/directory/src/stripe/client.ts` (`isLiveKey`) and the
   live-event guard in the webhook, in a reviewed PR.
3. In live mode: create the webhook endpoint and the Customer Portal settings again (live and
   test are separate), set the live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and run
   `pnpm directory:stripe sync` (dry run), then `--execute`.
4. Buy one Enhanced listing with a real card on a staff-owned test listing, check the
   placement turns on, then cancel and refund it in the dashboard.

### Products
`pnpm directory:stripe sync` makes one Price per featured spot (lookup key
`towncore:<town>:sponsored_slot:r<rank>:<cents>`). The trial is Stripe's own
`trial_period_days`: Stripe takes the card at Checkout and charges when the trial ends; a
subscription in `trialing` counts as active. `/advertise` on each town site shows the offer at
that town's prices, and which spots are open in a category.

| Product | Price | Status |
| --- | --- | --- |
| Enhanced listing | town `pricing.enhanced_usd` (Boca $39) | on |
| Featured spots #1, #2, #3 | town `pricing.featured_usd` (Boca $19, $12, $7), one business per spot and category; a business's first spot is free for `pricing.free_trial_days` (30) | on |
| Category sponsorship (`exclusive`) | town `pricing.category_month_usd` (tier lists; Boca $75), one business per category and calendar month, paid once; the category's price moves monthly like the spots | on (2026-10-17) |
| Newsletter sponsorship (`newsletter`) | town `pricing.newsletter_week_usd` (tier lists; Boca $45), one business per week, paid once | on (2026-10-17) |
| Business spotlight | not priced | built, off (`DIRECTORY_PRODUCTS_PREVIEW=spotlight` previews it in development and tests) |

Dated bookings (newsletter weeks, category months) have no Stripe Price: Checkout charges the
current price once (`price_data`), so `sync` and `check` cover the monthly products only. Every
sponsor card, dated or monthly, is still approved by staff before it runs (D-M6-7).

## Leads, slot counts and proof reports (M6 PR E)

- **Quote requests** (D-M6-9): the form on a category page appears only when the category has
  claimed businesses with an active sponsored slot. One request goes to up to 3 of them, as
  separate `leads` rows sharing a `request_id`, each emailed from `listings@<town domain>` with
  Reply-To set to the reader. Limits: 5 requests an hour per IP, 3 a day per email address.
  The reader ticks a box naming the businesses before anything is sent.
- **Calls** (D-M6-8): no tracked numbers. A tap on a listing's call button is logged as a
  `call` lead; the phone dials the real number.
- **`slot_stats_daily`**: impressions (at least half the unit on screen), clicks and leads per
  slot, campaign and business, per day in the town's time zone. Cookieless; crawlers aren't
  counted. A listing's "views" are impressions of its contact area.
- **Proof reports** (D-M6-10): owners see any month at `/owner/<listing>/report`. On the 1st to
  3rd of each month the worker emails last month's report to every claimed business that had a
  paid placement during it, once per business and month (`proof_reports`), through the
  conversational stream. It sends nothing until SES sending is set up.

## Outreach drafts (CLAUDE.md §11, M6 PR F)

When a published story names a listed business (its topic entity matches the listing's name),
or was written from the business's own license record, the worker drafts a short email after
each story-finder run: the story, the listing, and for an unclaimed listing how to claim it for
free. Roundups and alerts never draft (one roundup names dozens of filings). A business gets at
most one draft in 30 days, and two listings with the same name get none (we can't tell which
one the story means).

Nothing is sent by code (Rule 10). In Admin → Directory → **Outreach drafts** (the inbox shows a
link when any are waiting):
1. Check the story really is about this business.
2. Claimed listings already have the owner's address. For an unclaimed one, find an address on
   the business's own website; never guess one or take it from another directory or social
   media. No address: dismiss the draft.
3. Edit the text if needed and press **Send**. It goes out from `sales@<town domain>` as a new
   inbox conversation, so replies land with Sales. Suppressed addresses ask for a second
   confirmation.
4. If someone replies "no thanks", press **Don't email … again** on the conversation. That is a
   manual suppression: the business gets no more drafts, and any staff email to the address
   needs a second confirmation.

Every send and dismissal is audited.
