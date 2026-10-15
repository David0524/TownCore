# Plan: Mail (multi-domain email platform)

Status: **draft, waiting on the owner's rulings (D-MAIL-1 to D-MAIL-14).**
Date: 2026-10-15
Brief: [`docs/mail/BRIEF.md`](../mail/BRIEF.md), the owner's spec, kept as uploaded.

## What this adds to TownCore

One shared inbox and sending system for every town domain, inside this monorepo:

- **Receive** mail sent to any address on any town domain (`sales@`, `news@`, `anything@`). Each address routes to a central team by its role.
- **Reply** from the exact town address the mail was sent to.
- **Send newsletters** per town from `news.<domain>`. This becomes the sending layer for M5.
- **Onboard** a domain with one command that creates its SES identities and email DNS records.

All of it runs on AWS SES. Recipients only ever see the town's own brand, which matches Rule 1.

## Facts checked (AWS docs, 2026-10-15)

| Fact | Finding | Effect on the plan |
| --- | --- | --- |
| Receiving regions | `us-east-1` supports receiving (`inbound-smtp.us-east-1.amazonaws.com`), as do us-east-2, us-west-1 and us-west-2. | Use `us-east-1` unless the owner picks another. |
| One catch-all receipt rule | A rule with no recipient conditions applies to "all recipients in all verified domains". Rules with conditions allow at most 100 per rule. | One rule covers every town. Adding a domain needs no rule change, as the brief intends. |
| Account review levels | Under review at **5% bounces** or **0.1% complaints**. Sending may be paused at **10%** or **0.5%**. | The brief's defaults are right: per-domain auto-pause at 3% / 0.08%, network-wide bulk pause before 5% / 0.1%. |
| Detecting an account pause | SES sends no event for an account-level pause. Read `GetAccount` → `EnforcementStatus`. Don't use `GetAccountSendingEnabled`. | The worker polls `EnforcementStatus` and alerts (Mail-6). |
| Default quotas per region | 10,000 configuration sets. 10,000 tenants. Sandbox: 200 emails a day, 1 per second. All adjustable. | Use shared configuration sets, not one per domain (D-MAIL-12). Production access is an owner action. |
| DKIM records | Always build the CNAMEs from the `SigningHostedZone` that `CreateEmailIdentity` / `GetEmailIdentity` return. Never hardcode `dkim.amazonses.com`. | Record generation reads that value from the API response. Tests cover it. |
| **SES tenants (new feature)** | Tenants group identities and configuration sets, track reputation per tenant, and can pause one tenant without pausing the account. Tenant-level suppression lists are available. There is a per-tenant monthly charge. | This could replace much of the brief's §7.2 risk with an SES-native control. It costs money, so it's stop-and-ask (D-MAIL-13). |

Still to check in the phase that needs it: Vercel DNS REST endpoints and rate limits (Mail-1), the verified-identity quota (two identities per town), and SES Message-ID rewriting (Mail-4, tested in practice as the brief asks). Gmail and Yahoo sender rules get rechecked in Mail-5.

---

## Where it lives

| Piece | Location | Notes |
| --- | --- | --- |
| Inbox, domains page, subscribers, campaigns UI | `apps/web`, under `/admin/mail/*` on the internal host | Reuses the staff admin, its sessions and its layout. Town hosts never serve `/admin` (this is already enforced in `proxy.ts`). |
| SNS webhooks, unsubscribe, signup and confirm endpoints | `apps/web/src/app/api/mail/*` | Webhooks and staff pages are internal-host only. Signup, confirm and unsubscribe are also served on each town's own domain, so links read as that town. |
| Jobs: parse, send, campaign fan-out, warm-up, health, onboarding | `apps/worker` (pg-boss on Railway) | Meets the brief's "durable, retryable, not limited by Vercel timeouts". No new queue service. |
| SES client, MIME build/parse, threading, routing, suppression, unsubscribe tokens, warm-up math, DNS record generation | new `packages/mail` | Pure logic is unit-tested. Every AWS and Vercel call goes through one small client interface, so tests run on recorded fixtures (the same idea as the adapters). |
| Newsletter content | `packages/email` (M5) | It builds the issue. `packages/mail` sends it. `packages/email`'s log provider stays for development. |
| Onboarding CLI | `packages/mail`, run as `pnpm mail:onboard add …` | `--dry-run` by default; `--execute` to apply. It uses separate, broader AWS and Vercel credentials and never runs in the web app. |
| AWS infrastructure as code | new `packages/infra` (AWS CDK, TypeScript) | Defines the S3 bucket and lifecycle, SNS topics, receipt rule set and rule, two configuration sets per environment with event destinations, and least-privilege IAM. Deployed by hand, never from CI (Rule 10). |
| Schema | `packages/db` | Drizzle migrations, the same as every other table. |
| Runbook | `docs/mail/RUNBOOK.md` | Decisions and status stay in CLAUDE.md (D-MAIL-11). |

---

## Decisions for the owner

Each item says what conflicts, then my recommendation. You asked to rule on each one.

**D-MAIL-1 — Email provider.** CLAUDE.md §3 says "Resend or Amazon SES", and the M3 plan picked Resend for staff sign-in (D-M3-2). The brief fixes SES for everything.
→ **Recommend SES for all email**, staff sign-in links included. That means one provider, one suppression list and one set of DNS records. Resend was never wired up, so nothing is lost. Update §3.

**D-MAIL-2 — Staff sign-in.** CLAUDE.md §3 says "email magic link". The brief says Google sign-in, limited to `@<HQ_DOMAIN>` plus a database allow-list.
→ **Recommend Google sign-in for all of `/admin`**, with the allow-list in the `staff` table. Keep the magic link for local development only. Two sign-in methods for one admin is more surface for no gain. This needs `<HQ_DOMAIN>` (is it `towncore.net` on Google Workspace?) and a Google OAuth client.

**D-MAIL-3 — Staff and teams.** The brief has `users` (`admin|member`). TownCore has `staff` (`admin|reviewer`, plus the placeholder flag).
→ **Recommend extending `staff`** instead of adding `users`: add `active`, and add `teams`, `team_members` and `role_addresses`. A person can be both a reviewer and on the Sales team.

**D-MAIL-4 — Domains vs towns.** The brief's `domains` table repeats data that `towns` already holds (domain, name, site name).
→ **Recommend a `mail_domains` table** with `town_id` (FK) and the brief's mail-only fields: status, inbound flag, bulk status, warm-up day, cap, pause reason, postal address. `display_name` defaults to the town's `site_name`. Today each town has one domain, but this keeps room for more.

**D-MAIL-5 — Name clashes.** `campaigns` already means ad campaigns (§11b). `admin_actions` is already the audit log.
→ **Recommend renaming the brief's tables** to `email_campaigns`, `email_campaign_sends` and `email_campaign_templates`, and **widening `admin_actions`** into the audit log for all staff actions (add `target_type` and `target_id`). No second audit table.

**D-MAIL-6 — Subscribers.** `subscribers` already exists, keyed by town.
→ **Recommend extending it**, still keyed by town: add the brief's statuses (`bounced`, `complained`) and consent fields (`consent_source`, `consent_ip`, `confirmed_at`, `unsubscribed_at`, `last_engaged_at`). M5 then uses it unchanged.

**D-MAIL-7 — Newsletter (M5) overlap.** M5 is the newsletter. The brief's Phase 5 is bulk sending.
→ **Recommend combining them.** Mail-5 builds the sending machinery: double opt-in, one-click unsubscribe, suppression, warm-up and auto-pause. M5 builds the daily issue content (§11) and hands each issue to Mail-5 as an `email_campaign`. The newsletter is sent from `newsletter@news.<domain>`, with `Reply-To` set to `news@<domain>`.

**D-MAIL-8 — Public contact address.** CLAUDE.md Decisions plan for `news@{domain}` to forward to info@towncore.net, which needs mail forwarding set up per domain.
→ **Recommend replacing forwarding with SES inbound.** `news@` becomes a role address routed to an Editorial team. This removes the per-domain forwarding to-do from M1's open list.

**D-MAIL-9 — DNS provider for future towns.** CLAUDE.md lists Cloudflare for DNS/CDN and leaves "DNS provider for future towns" open until M7. The brief fixes Vercel DNS.
→ **Recommend Vercel DNS for every town.** That settles the open M7 item. `CLOUDFLARE_API_TOKEN` stays in `.env.example` until §3 is updated.

**D-MAIL-10 — Database host and backups.** The brief says Neon or Supabase. TownCore decided on Railway Postgres.
→ **Recommend Railway Postgres** (already decided). Before Mail-5 holds real subscribers, confirm Railway's backup and point-in-time-restore options and document them in the runbook.

**D-MAIL-11 — Rule 10 and automatic sends.** Rule 10 says no email to real people without an explicit human approval step. Three kinds of mail need a ruling:
- **Staff replies.** A person presses Send, which is the approval. No change needed.
- **Newsletter issues and campaigns.** → **Recommend a per-town standing approval**: an admin turns on "daily newsletter" for a town, and that choice is stored and audited. One-off campaigns need an "Approve send" click by an admin, someone other than the author when possible.
- **Double opt-in confirmations.** These go only to someone who just submitted the form. → **Recommend a standing exception**, recorded in Decisions, rate-limited and honeypot-protected.

**D-MAIL-12 — Configuration sets.** The brief says each stream has "its own configuration set". Read per domain, that's 2 sets per town, which hits the 10,000 default quota at 5,000 towns.
→ **Recommend two shared sets per environment** (`conversational`, `bulk`) and tag every message with `domain` and `stream`. Per-domain metrics come from those tags. Each domain still has its own identities, DKIM keys and MAIL FROM, as the brief requires.

**D-MAIL-13 — SES tenants (adds cost, stop-and-ask).** One tenant per town would let SES itself pause a single bad town instead of the whole account. Our own auto-pause (§7.2) is still built either way.
→ **Recommend: not in v1.** Build the brief's own auto-pause first. Look at tenants again before bulk volume passes ~50 towns, once I can quote the per-tenant price. Approving it later changes only the send call and onboarding.

**D-MAIL-14 — Where decisions and status go.** The brief wants `docs/DECISIONS.md` and `docs/STATUS.md`. TownCore keeps Decisions and Status in CLAUDE.md.
→ **Recommend CLAUDE.md**, with a short pointer to this plan and the brief from §3 and §4. Add only `docs/mail/RUNBOOK.md`.

### Smaller choices I'll make and log (bucket B in the brief)

- **Infrastructure as code:** AWS CDK in TypeScript (keeps the repo TypeScript-only).
- **Libraries:** `@aws-sdk/client-sesv2`, `client-s3`, `client-sns`; `mailparser` to parse; nodemailer's `MailComposer` to build; `sanitize-html` for inbound HTML.
- **Unknown recipients:** mail to an unknown address on an onboarded domain goes to the catch-all team (Admin). Mail to a domain that isn't onboarded is logged and dropped.
- **Unsubscribe tokens:** HMAC-SHA256 over (subscriber id, town id) with a server secret. They never expire.
- **Notifications:** in-app unread counts first. A daily email digest comes later.
- **Warm-up ramp:** a config table starting at 50 a day and doubling every 3 healthy days up to the target cap. A day with a breach holds the ramp, and two in a row step it back.

---

## Phases

These follow the brief's phases 0–6 and take its acceptance criteria as written. Each phase is its own small PR or PRs.

| Phase | Builds | Blocked on (owner inputs) |
| --- | --- | --- |
| **Mail-0** Setup | `packages/mail` and `packages/infra` skeletons; env vars; Google sign-in (D-MAIL-2); schema for teams and roles; dev infrastructure in CDK; owner checklist | AWS account access, `<HQ_DOMAIN>`, Google OAuth client |
| **Mail-1** Onboarding | `mail:onboard add/status/retry/verify-all` state machine; Vercel DNS conflict detection; `/admin/mail/domains` | Vercel token with DNS scope and team ID; 3 test domains; DMARC report address |
| **Mail-2** Inbound | Receipt rule, SNS webhook with signature checks, parse job, threading, attachments, verdicts | SES region set up; test inbox addresses |
| **Mail-3** Inbox UI | Thread list, filters, sandboxed message view, notes, assign, status, spam | Team names and role mapping |
| **Mail-4** Replies | Composer, MIME, threading round-trip, SES events, suppression warnings | SES production access (sandbox can only send to verified addresses) |
| **Mail-5** Newsletters (with M5) | Signup form for town sites, double opt-in, campaigns, warm-up, one-click unsubscribe, auto-pause | Postal address; EU or Canadian subscribers?; D-MAIL-11 ruling |
| **Mail-6** Ops (with M8) | Health dashboard, alerts, `EnforcementStatus` poll, DMARC reports, runbook | — |

**Proposed order alongside the milestones:** the first live M3 run and M4 carry on as planned. Mail-0 and Mail-1 can start as soon as AWS and Vercel access exist. Mail-2 to Mail-4 come before M6, because the directory claim flow and business outreach need working email. Mail-5 is built together with M5. Mail-6 is built together with M8.

## Owner inputs needed (tracked in CLAUDE.md Status)

- [ ] `<HQ_DOMAIN>`: is it `towncore.net` on Google Workspace?
- [ ] AWS account access, and the SES region (recommend `us-east-1`)
- [ ] SES production access request (I'll draft the use-case text; you submit it)
- [ ] Vercel API token with DNS scope, and the team ID
- [ ] Test domains and external test inbox addresses
- [ ] DMARC report address (if it's on another domain, I'll document the one-time `_report._dmarc` record)
- [ ] Postal address for newsletter footers
- [ ] Teams and role mapping (e.g. `sales` → Sales, `admin` → Admin, `news` → Editorial, catch-all → Admin)
- [ ] Staff allow-list (about 6 people)
- [ ] How long to keep raw mail
- [ ] Whether EU or Canadian subscribers are expected

## New environment variables (added to `.env.example` in Mail-0)

`AWS_REGION`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (app: send and inbound bucket only), `MAIL_S3_BUCKET`, `SES_CONFIG_SET_CONVERSATIONAL`, `SES_CONFIG_SET_BULK`, `VERCEL_DNS_TOKEN`, `VERCEL_TEAM_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `HQ_DOMAIN`, `DMARC_REPORT_ADDRESS`, `MAIL_TOKEN_SECRET` (unsubscribe and confirm tokens), `MAIL_POSTAL_ADDRESS`. The onboarding CLI's broader AWS credentials are only in the operator's local environment. They're documented in the runbook and never in `.env.example` values.
