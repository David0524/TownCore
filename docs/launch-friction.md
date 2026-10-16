# Launch friction

Every manual step a launch needed (CLAUDE.md §10). The goal is to drive this list to zero:
when a step repeats across towns, automate it.

## Delray Beach, FL (2026-10-16)

- Readiness is 0.2 a day, below 3 (Rule 7): find more official sources the bot may read, or build the adapter requests, then resume with --source kind=url.
- Buy delrayledger.com (Rule 10): `pnpm launch "Delray Beach, FL" --resume --approve-spend`
- Stripe test prices for this town: `pnpm directory:stripe sync --town delray-beach --execute`
- Mail domain: SES identities and DNS on Vercel (Rule 10): `pnpm mail:onboard add delrayledger.com --execute --approved`
- Attach the domain to the Vercel web project (production deploy, Rule 10): `Vercel dashboard → Project → Domains → add delrayledger.com and www.delrayledger.com`
- Trademark: search the picked name at https://tmsearch.uspto.gov/ (D-M7-4).
- Social handles: claim the name on Facebook, Instagram and X by hand (D-M7-5); upload the identity assets.
- Facebook page for delrayledger.com, with the cover and avatar from identity/.
- Google News Publisher Center and Search Console for delrayledger.com (D-M4-6).
- Pick the masthead option above (the theme uses the first unless changed).
- Map the evergreen guide topics to official pages (guides: in the town YAML), then review the first batch (D-M4-2).
- Check the archive history of delrayledger.com by hand: https://web.archive.org/web/*/delrayledger.com
- Write identity notes for the theme (no model ran): landscape, architecture, signature places.
- Turn on Stripe live mode only when you decide (runbook "Going live", D-M6-5).
