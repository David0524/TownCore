# Directory runbook (M6)

How to run the business directory's paid side. Decisions: `docs/plans/M6.md` (D-M6-1 to 11).

## Stripe: test mode only (D-M6-5)

Code refuses live keys (`sk_live_…`, `rk_live_…`) and live-mode webhook events. Live payments
need the owner's explicit approval and a code change that lifts that guard, per environment.

### Set up test mode
1. In the Stripe dashboard (test mode), create a restricted or secret **test** key and set
   `STRIPE_SECRET_KEY` in the web app's environment.
2. Add a webhook endpoint at `https://<APP_BASE_URL host>/api/stripe/webhook` (the admin host;
   town sites have no webhook) for these events:
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

### How a purchase works
- An owner of an approved claim opens **Manage your listing** on the town site and presses
  **Buy**. Inventory is checked (sponsored slots: 3 per category; a started Checkout holds a
  place for an hour), then Stripe Checkout opens in subscription mode.
- Only the verified webhook turns a placement on. A Checkout that completes after its category
  filled up is **held**: paid, never shown.
- Past-due subscriptions stay on while Stripe retries; when retries end (`unpaid`) or the
  subscription is canceled, the placement turns off.

### Refunds and held placements
Staff never charge a card. Refunds happen in the Stripe dashboard:
1. Admin → Directory → **Paid placements** lists held placements first.
2. Open the subscription in Stripe (the `sub_…` id shown), cancel it and refund the payment, or
   offer the business the next opening and leave it held until then.

### Products
| Product | Price | Status |
| --- | --- | --- |
| Enhanced listing | town `pricing.enhanced_usd` (Boca $39) | on |
| Sponsored slot | town `pricing.sponsored_slot_usd` (Boca $199), 3 per category | on |
| Category exclusive | not priced | built, off |
| Newsletter sponsorship | not priced | built, off |
