# CLAUDE.md — Multi-Domain Email Platform

This file is the project brief for Claude Code. Read it fully at the start of every session. It describes what we are building, why, the fixed constraints, where you have freedom to decide, and the order to build things in.

---

## 1. What we're building

We run local news sites, one per town, and each town has its own domain (e.g. `bocatownsquare.com`). There will be hundreds and eventually thousands of these domains. The domains are hosted on **Vercel DNS**. Our internal company domain is `<HQ_DOMAIN>` (placeholder; the owner will supply it), on Google Workspace.

We need one internal web app that lets a team of about **6 people**:

1. **Receive** mail sent to any address at any town domain (e.g. `sales@bocatownsquare.com`, `admin@…`, `anything@…`) in one shared inbox, routed to central teams by role.
2. **Reply** from the exact town address the message was sent to, so each town reads as an independent local brand.
3. **Send newsletters / bulk mail** per town to that town's subscribers, from a dedicated newsletter subdomain.
4. **Onboard new domains** with one command, which creates all email DNS records automatically.

**Routing model:** roles are the same for every town. `sales@<any town>` goes to the Sales team, `admin@<any town>` goes to Admin, and so on. Anything unrecognized goes to a catch-all team (Admin by default). There are no per-town staff or per-town permissions.

**Explicitly not a goal:** looking like a network of related sites to recipients. Every outgoing email must look like it came from that town's own brand: its own From address, its own signature, its own DKIM signature.

---

## 2. How to work in this repo

### 2.1 Your latitude

You are expected to make engineering judgment calls. The owner wants a working, maintainable system, not one that waits for permission on every detail. To make that workable, every decision falls into one of three buckets:

**A. Fixed decisions — do not change without asking the owner.**
These are listed in §3. They are deliberate business, cost, or deliverability choices.

**B. Open decisions — you choose, then record the choice.**
Library choices, code structure, schema details, UI layout, job framework, testing approach, and anything else not fixed in §3. Pick what you judge best. Record each meaningful choice in `docs/DECISIONS.md` as a short entry: the date, the decision, the alternatives you considered, and why you chose this one. If something in this file turns out to be wrong or outdated (an API changed, a limit is different, a better approach exists), you may deviate. Log the deviation and the reason in `DECISIONS.md`, and mention it to the owner at the end of the session.

**C. Stop and ask — always confirm with the owner first.**
- Anything that **sends email to real recipients** outside the test/simulator addresses in §9.
- Any **DNS change on domains other than the designated test domains** (§9.2), and any bulk DNS run.
- **Deleting or overwriting** existing DNS records, S3 objects, or database rows outside dev.
- Anything that **adds a recurring cost** (new paid service, dedicated IPs, a plan upgrade) or is likely to raise monthly spend by more than about $25.
- **Tightening DMARC policy** (`p=none` → `quarantine`/`reject`) on any domain.
- **Requesting or changing SES account settings** (production access, quota increases, account-level suppression settings).
- Adding features listed as out of scope in §12.
- Any change to the fixed decisions in §3.

When in doubt between B and C, treat it as C.

### 2.2 Working conventions

- **TypeScript, strict mode,** everywhere: app, scripts, and workers.
- **Small, reviewable commits** with clear messages. Finish and verify one phase before starting the next (§8).
- **Every operation that touches DNS, SES identities, or sends in bulk must support `--dry-run`.** In dry-run mode it prints exactly what it would do and changes nothing. Dry-run is the default for scripts. Real execution requires an explicit `--execute` flag.
- **Idempotent operations.** Running onboarding twice on the same domain must not create duplicate records or errors. Retries must be safe.
- **Never commit secrets.** Use environment variables; keep `.env.example` up to date with every variable name and a one-line description.
- **Migrations for every schema change.** Never edit the production schema by hand.
- **Tests** for the logic that's easy to get wrong: email parsing, threading, routing, suppression checks, unsubscribe tokens, warm-up caps, and DNS record generation. UI tests are optional.
- **Verify external APIs against current documentation** (AWS SES v2, Vercel REST API, Gmail/Yahoo sender requirements) rather than relying on the snippets in this file. The snippets show intent; the current docs are authoritative.
- At the end of each session, update `docs/STATUS.md` with what was done, what's next, and any open questions for the owner.

---

## 3. Fixed decisions

1. **Email infrastructure: AWS SES (v2 API)** for both receiving and sending. No self-hosted mail server.
2. **AWS region:** one SES region that supports **email receiving** (likely `us-east-1`; confirm against current AWS docs). Everything SES-related lives in that region.
3. **DNS: Vercel DNS,** managed only through the Vercel REST API, with an API token.
4. **App:** Next.js (App Router), deployed on Vercel.
5. **Database:** Postgres (hosted on Neon or Supabase; the choice is yours, an open decision).
6. **Raw mail and attachments** are stored in S3, in a bucket in the same region as SES.
7. **Staff login:** Google sign-in, restricted to `@<HQ_DOMAIN>` accounts, plus an allow-list of users in the database. No passwords.
8. **Two sending streams per town domain, kept fully separate:**
   - **Conversational** (replies, one-off emails): sent from the root domain, e.g. `sales@bocatownsquare.com`.
   - **Bulk** (newsletters): sent from the subdomain `news.<domain>`, e.g. `newsletter@news.bocatownsquare.com`.
   - Each stream has its own SES identity, its own DKIM keys, its own custom MAIL FROM domain, and its own SES configuration set.
9. **Per-domain DKIM** using SES Easy DKIM. Never share signing keys across domains.
10. **DMARC starts at `p=none`** for every domain. Tightening it is an owner decision (§2.1 C).
11. **Compliance requirements in §7 are mandatory,** not optional polish.
12. **Build order follows the phases in §8.**
13. **No open or click tracking** by default. If it is built later, it must be off unless the owner turns it on.

---

## 4. Architecture overview

```
                 ┌─────────────────────── AWS (one SES region) ───────────────────────┐
 Sender ──SMTP──▶│ SES inbound ──receipt rule──▶ S3 (raw .eml) ──▶ SNS topic          │
                 │                                                    │               │
                 │ SES outbound ◀── SendEmail (raw) ── App/worker      │               │
                 │      │                                             │               │
                 │      └─ config sets ─▶ SNS (bounce/complaint/delivery events)      │
                 └──────────────────────────────────┬──────────────────┬──────────────┘
                                                    │ HTTPS (signed)   │
                                                    ▼                  ▼
                         ┌───────────────── Vercel ─────────────────────────────┐
                         │ Next.js app: webhooks, inbox UI, API, signup forms   │
                         │ Background jobs (queue): parsing, sends, onboarding  │
                         └───────────────┬──────────────────────────────────────┘
                                         ▼
                                    Postgres  ◀── onboarding CLI ──▶ Vercel DNS API
```

### 4.1 Inbound flow

1. SES receives mail for every verified town domain. The MX record points to the SES inbound endpoint.
2. One **catch-all receipt rule** matches all verified domains. (A receipt rule with no recipient conditions applies to every verified domain. Confirm this in the current docs.) Using one rule avoids the per-rule recipient limits and means no rule changes are needed when a domain is added.
3. The rule's S3 action writes the raw message to `s3://<bucket>/inbound/<messageId>` and publishes an SNS notification.
4. SNS pushes to the app's webhook (`/api/webhooks/ses-inbound`). The webhook **verifies the SNS message signature**, records the event, and enqueues a parse job. It returns quickly, never parsing inline.
5. The parse job fetches the raw message from S3, parses it, applies spam and virus verdicts, resolves the town domain and role, threads it, and stores it.

### 4.2 Outbound conversational flow

The user replies in the UI. The app builds a MIME message with the correct From, threading headers, and signature, then sends it through SES with the **conversational** configuration set. The message is stored as outbound in the thread. SES events (delivery, bounce, complaint) arrive by SNS and update its status.

### 4.3 Outbound bulk flow

A campaign is scheduled. A job expands it into per-subscriber sends, filters out suppressed addresses, applies per-domain warm-up caps, and sends in throttled batches through SES with the **bulk** configuration set. Events update per-send status and feed the suppression list and domain health metrics.

### 4.4 Onboarding flow

A CLI command (and later an admin UI button) takes domain names and runs a resumable state machine for each:

1. Create the SES identities.
2. Write the DNS records through the Vercel API.
3. Poll until SES reports the domain verified.
4. Mark the domain live for inbound.
5. Mark it in warm-up for bulk.

---

## 5. Stack details

| Concern | Fixed | Your choice (log it) |
|---|---|---|
| Language | TypeScript strict | — |
| Framework | Next.js on Vercel | UI component library, styling |
| DB | Postgres | Host (Neon/Supabase), ORM (Drizzle/Prisma/Kysely), migration tool |
| Email | AWS SES v2 | SDK usage pattern |
| Storage | S3 | — |
| Queue / jobs | Must be durable, retryable, and not limited by Vercel function timeouts | Inngest, Trigger.dev, SQS + worker, or similar |
| AWS infra | Must be defined as code | CDK, SST, Terraform, or Pulumi |
| Auth | Google OAuth restricted to HQ domain + allow-list | Auth library (Auth.js, etc.) |
| MIME parsing | — | e.g. `mailparser` |
| MIME building | — | e.g. `nodemailer`'s MailComposer |
| HTML sanitizing | Required for all inbound HTML | Library choice |
| Newsletter editor | — | Simple: a Markdown/MJML template plus a preview is fine |

**AWS infrastructure as code** must define:
- the S3 bucket, with lifecycle rules (see §10),
- the SNS topics,
- the SES receipt rule set and rule,
- both configuration sets and their event destinations,
- the IAM roles and policies (least privilege; the app's credentials can send email and read the inbound bucket, nothing more).

---

## 6. Data model (starting point)

This is a sketch, not a contract. Refine names, types, and indexes as you see fit, and log significant changes. Every table gets `id`, `created_at`, and `updated_at` unless noted.

**Domains and onboarding**
- `domains`: `name` (unique, lowercase), `town_name`, `display_name` (brand name used in From headers), `status` (`pending` | `onboarding` | `live` | `paused` | `failed`), `inbound_enabled`, `bulk_status` (`not_started` | `warming` | `active` | `paused`), `warmup_day`, `bulk_daily_cap`, `paused_reason`, `postal_address` (for CAN-SPAM footers; can default to a company-wide address).
- `domain_identities`: `domain_id`, `kind` (`root` | `news`), `identity_name` (e.g. `news.bocatownsquare.com`), `ses_verification_status`, `dkim_status`, `mail_from_domain`, `mail_from_status`, `last_checked_at`.
- `dns_records`: `domain_id`, `type`, `name`, `value`, `priority`, `ttl`, `vercel_record_id`, `purpose` (`inbound_mx`, `dkim`, `mail_from_mx`, `mail_from_spf`, `spf`, `dmarc`, …), `status`.
- `onboarding_runs` / `onboarding_steps`: a per-domain state machine with each step's status, attempt count, last error, and timestamps, so runs can be resumed.

**People and routing**
- `users`: `email` (must be `@<HQ_DOMAIN>`), `name`, `role` (`admin` | `member`), `active`.
- `teams`: `name` (e.g. Sales, Admin, Editorial).
- `team_members`: `team_id`, `user_id`.
- `role_addresses`: `local_part` (e.g. `sales`), `team_id`, `is_catch_all` (exactly one row is the catch-all). These are global and apply to every domain.
- `signatures`: a template with variables (`{{town_name}}`, `{{user_name}}`, `{{role}}`, `{{domain}}`), per role or per user. Rendered per town at send time.

**Conversations**
- `contacts`: `email` (normalized), `name`.
- `threads`: `domain_id`, `team_id`, `assignee_id` (nullable), `status` (`open` | `pending` | `closed` | `spam`), `subject`, `contact_id`, `town_address` (the exact address the conversation is with, e.g. `sales@bocatownsquare.com`), `last_message_at`.
- `messages`: `thread_id`, `direction` (`inbound` | `outbound`), `rfc_message_id`, `in_reply_to`, `references` (array), `from`, `to`, `cc`, `envelope_recipient`, `subject`, `text_body`, `html_body_sanitized`, `raw_s3_key`, `spam_verdict`, `virus_verdict`, `dkim_verdict`, `spf_verdict`, `dmarc_verdict`, `sent_by_user_id`, `ses_message_id`, `delivery_status`.
- `attachments`: `message_id`, `filename`, `content_type`, `size`, `s3_key`, `content_id` (for inline images).
- `notes`: `thread_id`, `user_id`, `body` (internal; never emailed).
- `audit_log`: `user_id`, `action`, `target_type`, `target_id`, `metadata`. Covers sends, assignments, status changes, onboarding, and settings changes.

**Bulk**
- `subscribers`: `domain_id`, `email`, `status` (`pending` | `active` | `unsubscribed` | `bounced` | `complained`), `consent_source` (form URL or import name), `consent_ip`, `consent_at`, `confirmed_at`, `unsubscribed_at`, `last_engaged_at` (nullable). Unique on (`domain_id`, `email`).
- `campaign_templates`: one template that can fan out to many towns, with `subject_template` and `body_template` using town variables.
- `campaigns`: `domain_id`, `template_id` (nullable), `subject`, `html`, `text`, `scheduled_at`, `status` (`draft` | `scheduled` | `sending` | `sent` | `paused` | `cancelled`), `created_by`.
- `campaign_sends`: `campaign_id`, `subscriber_id`, `status` (`queued` | `sent` | `delivered` | `bounced` | `complained` | `suppressed` | `deferred_cap`), `ses_message_id`, `sent_at`.
- `suppressions`: `email`, `scope` (`global` | `domain`), `domain_id` (nullable), `reason` (`hard_bounce` | `complaint` | `unsubscribe` | `manual`), `source_event_id`. **Checked before every send, in both streams.** Unsubscribes and suppressions from the bulk stream apply only to bulk mail; hard bounces and complaints apply to both streams.
- `email_events`: the raw SES event JSON plus parsed fields (`type`, `ses_message_id`, `recipient`, `timestamp`, `configuration_set`). Kept for metrics and debugging.
- `domain_health_daily`: `domain_id`, `date`, `stream`, `sent`, `delivered`, `bounced`, `complained`. Used for warm-up and auto-pause decisions.

---

## 7. Deliverability and compliance (mandatory)

### 7.1 DNS records per town domain

The onboarding tool creates these records, using values read from the SES API responses (never hard-coded tokens). `<region>` is the SES region.

**Root domain (conversational stream + inbound):**

| Purpose | Type | Name | Value |
|---|---|---|---|
| Inbound | MX (priority 10) | `@` | `inbound-smtp.<region>.amazonaws.com` |
| DKIM ×3 | CNAME | `<token>._domainkey` | `<token>.dkim.amazonses.com` |
| Custom MAIL FROM | MX (priority 10) | `mail` | `feedback-smtp.<region>.amazonses.com` |
| MAIL FROM SPF | TXT | `mail` | `v=spf1 include:amazonses.com ~all` |
| Root SPF | TXT | `@` | `v=spf1 include:amazonses.com ~all` |
| DMARC | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<DMARC_REPORT_ADDRESS>; fo=1` |

**News subdomain (bulk stream):**

| Purpose | Type | Name | Value |
|---|---|---|---|
| DKIM ×3 | CNAME | `<token>._domainkey.news` | `<token>.dkim.amazonses.com` |
| Custom MAIL FROM | MX (priority 10) | `bounce.news` | `feedback-smtp.<region>.amazonses.com` |
| MAIL FROM SPF | TXT | `bounce.news` | `v=spf1 include:amazonses.com ~all` |
| DMARC | TXT | `_dmarc.news` | `v=DMARC1; p=none; rua=mailto:<DMARC_REPORT_ADDRESS>; fo=1` |

Notes:

- **Check current SES docs** for exact record formats and MAIL FROM requirements. Treat the table above as intent.
- The **news subdomain gets no inbound MX.** Newsletter replies go to the root domain through a `Reply-To` header (§7.3).
- If DMARC reports go to an address on a different domain, that domain needs an external-reporting authorization record, for example a wildcard `*._report._dmarc.<reports-domain>` TXT record set to `v=DMARC1`. Set this up once and document it.
- **Never clobber existing records.** Before writing, list the domain's existing records. If there is a conflict (an existing MX, SPF, or DMARC record with a different value), stop for that domain, mark it `failed` with a clear reason, and continue with the others. Resolving conflicts is a stop-and-ask item.
- Use backoff and respect rate limits for both the Vercel and SES APIs. Bulk onboarding must handle hundreds of domains unattended.

### 7.2 SES account health — one account, shared risk

All domains share **one SES account.** SES enforces bounce and complaint thresholds at the account level. If one bad town pushes the account over those thresholds, sending can be paused for **every** town, including replies. This is the most important operational risk in the system, so build defensively:

- **Auto-pause bulk sending per domain** when its trailing metrics cross thresholds. Make the thresholds configurable. Starting defaults:
  - bulk bounce rate > 3%, or
  - complaint rate > 0.08%,
  - measured over the last 7 days with a minimum sample size.
- **Pause all bulk sending** if account-level rates approach the SES review levels (check the current SES figures; historically about 5% bounces and 0.1% complaints).
- Auto-pause **never** affects the conversational stream unless the owner pauses it manually.
- Hard bounces and complaints go into the suppression list immediately.
- Keep the SES account-level suppression list enabled as a backstop, but the app's own `suppressions` table is the source of truth.

### 7.3 Bulk mail requirements (Gmail/Yahoo bulk sender rules, CAN-SPAM)

Every bulk message must have:

- A From address on `news.<domain>`, with a DKIM signature aligned to that subdomain.
- A `Reply-To` address on the root domain role, e.g. `editor@bocatownsquare.com`, or another configurable role.
- **One-click unsubscribe (RFC 8058):** both `List-Unsubscribe: <https://…/u/<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The token is signed and per subscriber per domain. It must not be guessable or enumerable, and the endpoint must work as a `POST` with no login. A `mailto:` unsubscribe option is optional.
- A **visible unsubscribe link** in the footer that leads to the same result.
- The **physical postal address** in the footer.
- Unsubscribes must take effect immediately: suppressed before the next send, and never later than required by law.
- A plain-text part alongside the HTML.
- Sends only to subscribers who are `active` and confirmed through double opt-in, or imported with documented consent (the owner approves every import; this is stop-and-ask).

Targets:
- Keep the spam complaint rate as reported in Google Postmaster Tools **below 0.1%**, and never at or above 0.3%.
- Store consent evidence: source, IP address, timestamp, and confirmation timestamp.
- If EU or Canadian subscribers are possible, flag GDPR/CASL considerations to the owner. Don't solve them silently.

### 7.4 Warm-up

New `news.` subdomains start in `warming` status, with a daily cap that ramps up over several weeks.

- Store the schedule as configuration (a table or config file), not hard-coded. A reasonable starting ramp is roughly doubling every few days from about 50 per day, but choose and document your schedule.
- The ramp **advances only if** the domain's health metrics stay under thresholds. If they don't, it holds or steps back.
- During warm-up, send to the **most recently confirmed and most engaged** subscribers first.
- Sends that exceed the cap are marked `deferred_cap` and rolled into the next day. They are not dropped.

### 7.5 Conversational mail details

- **Reply from the address the message was originally sent to.** Determine it from the SES envelope recipient in the receipt notification, which handles BCC and catch-all cases, not just the `To:` header. If the address isn't a known role (a catch-all hit), reply from that exact address anyway.
- From display name: the town brand plus an optional person or role, e.g. `"Boca Town Square Sales" <sales@bocatownsquare.com>`. Make the format configurable.
- **Threading:** set `In-Reply-To` and `References` on every reply. SES may replace or set the `Message-ID` on outbound mail. **Verify this empirically in Phase 4** and store whatever Message-ID recipients actually see, so their replies thread back correctly.
- **Loop protection:** never auto-reply. Ignore or flag inbound mail carrying `Auto-Submitted`, `Precedence: bulk` or `Precedence: list`, or `X-Autoreply` headers when building metrics or notifications. Rate-limit any automatic behavior added later.

---

## 8. Build phases

Each phase lists **acceptance criteria.** A phase is done when every criterion has been demonstrated, either with tests or a short manual verification recorded in `docs/STATUS.md`. Don't start the next phase until the owner confirms. You can, however, prepare scaffolding for the next phase if it's harmless.

### Phase 0 — Project setup

- Repo scaffold: Next.js app, a `scripts/` or `cli/` package, shared `lib/`, infrastructure-as-code package, `docs/` (`DECISIONS.md`, `STATUS.md`, `RUNBOOK.md`).
- Environments: `dev` and `prod` at minimum. The dev environment uses separate configuration sets, a separate S3 prefix or bucket, and a separate database.
- `.env.example`, linting, formatting, type-checking, and a test runner in CI (GitHub Actions or the Vercel build).
- Google sign-in restricted to `@<HQ_DOMAIN>` plus the allow-list. A seeded admin user.
- Infrastructure as code for S3, SNS, configuration sets, and IAM. Deploy it to dev.
- A checklist in `STATUS.md` for owner-side actions: SES production access request, Vercel token, AWS account access, `<HQ_DOMAIN>` value, DMARC report address, postal address, test domains.

**Accept when:** staff can sign in, unknown Google accounts are rejected, CI passes, and the dev infrastructure deploys from code.

### Phase 1 — Domain onboarding

- CLI: `onboard add <domain…> [--from-file domains.txt] [--dry-run | --execute]`, `onboard status [<domain>]`, `onboard retry <domain>`, `onboard verify-all`.
- A per-domain state machine:
  1. Validate that the domain exists in the Vercel account and uses Vercel nameservers.
  2. List existing DNS records and detect conflicts.
  3. Create the SES identity for the root domain (Easy DKIM) and set its custom MAIL FROM.
  4. Do the same for `news.<domain>`.
  5. Write the DNS records (§7.1).
  6. Poll until verified.
  7. Mark the domain `live` for inbound and `warming` for bulk.
- Concurrency control and backoff. Resumable after a crash. Clear per-domain error messages.
- A simple domains page in the app: list, status, records, re-check button.

**Accept when:** 3 designated test domains onboard end to end, a second run is a no-op, a conflict is detected and reported without changes, and a crashed run resumes correctly.

### Phase 2 — Inbound pipeline

- Infrastructure as code for the catch-all receipt rule (S3 action plus SNS) and an active rule set.
- A webhook with SNS signature verification and subscription confirmation handling.
- A parse job:
  - fetch the message from S3 and parse it,
  - record spam, virus, SPF, DKIM, and DMARC verdicts,
  - quarantine `FAIL` virus verdicts (store them, never show the attachments),
  - send spam to `spam` status,
  - resolve the town domain and role from the envelope recipient,
  - thread the message,
  - store bodies and attachments.
- **Threading:** first match `In-Reply-To` and `References` against known Message-IDs. Otherwise, fall back to the same contact + same town address + normalized subject within N days (configurable). Otherwise, start a new thread.
- Inbound mail to a non-onboarded domain or an unknown recipient: log it and drop it, or route it to the catch-all. Your call; document it.
- Sanitize HTML at ingest. Keep the raw message in S3.

**Accept when:** mail sent from an external account to `sales@`, `admin@`, and `random@` on a test domain lands in the right team queues, a reply from that external account threads correctly, attachments and inline images are stored, and duplicate SNS deliveries don't create duplicate messages.

### Phase 3 — Inbox UI

- Thread list filterable by team, town, assignee, and status, with search by contact, subject, and town.
- Thread view:
  - messages rendered safely in a sandboxed iframe, with remote images blocked until the user clicks to load them,
  - attachments served through short-lived signed URLs,
  - internal notes.
- Actions: assign, change status, move to another team, mark spam / not spam.
- Unread state per user. A basic notification (email digest to the staff member's `@<HQ_DOMAIN>` address, or in-app only; your call).
- Keyboard-friendly, fast on a few thousand threads.

**Accept when:** the 6-person team could triage a realistic day of mail without touching the AWS console.

### Phase 4 — Outbound replies

- A reply composer with a signature rendered for the town and role, attachments, CC, and reply-all.
- Builds MIME correctly: From, `In-Reply-To`/`References`, text and HTML parts, attachments.
- Sends through SES v2 with the **conversational** configuration set and message tags (`domain`, `stream=conversational`).
- New outbound emails (not replies): pick a town and role address, enter a recipient, compose.
- SES events (delivery, bounce, complaint, reject) arrive through SNS and update message status. Bounces and complaints update suppressions. The UI warns before sending to a suppressed address.
- **Verify the outbound Message-ID behavior** and make threading round-trip correctly.

**Accept when:** a reply sent from the app arrives at Gmail and Outlook test inboxes threaded with the original, passes SPF, DKIM, and DMARC alignment (check the message headers), shows the town brand, and a recipient's reply threads back into the same conversation. Simulator bounce and complaint addresses produce the correct suppression rows.

### Phase 5 — Newsletters and bulk

- Subscriber management per town: list, search, export, manual unsubscribe.
- **Public signup endpoint and embeddable form** for the news sites:
  - double opt-in, with the confirmation email sent from the town's news subdomain,
  - honeypot plus rate limiting (CAPTCHA optional),
  - consent capture (§7.3).
- CSV import. Every import requires owner approval and a stated consent source; this is stop-and-ask.
- Templates: per-town campaigns and multi-town campaign templates that fan out with town variables. Preview per town. Test-send to staff.
- Scheduling and sending:
  - the queue expands each campaign into individual sends,
  - suppression and status filtering happen at send time, not only at scheduling,
  - per-domain warm-up caps (§7.4) and global SES rate limits are enforced,
  - sending is pausable and resumable, with no duplicate sends on retry.
- One-click unsubscribe endpoint plus a preference page.
- Bulk configuration set events feed `campaign_sends`, `suppressions`, and `domain_health_daily`.
- Auto-pause logic (§7.2).

**Accept when:**
- a campaign to a test list sends correctly with all the headers in §7.3,
- one-click unsubscribe works with no login and suppresses immediately,
- the warm-up cap defers excess sends to the next day,
- simulated complaints trigger auto-pause for that domain only,
- a retried job sends no duplicates.

### Phase 6 — Monitoring and operations

- A dashboard showing, per domain and per stream: sent, delivered, bounce rate, complaint rate, warm-up stage, and paused status. It also shows account-level rates against the SES thresholds.
- Alerts to the owner (email to an `@<HQ_DOMAIN>` address) on auto-pause, account rates approaching thresholds, onboarding failures, and repeated job failures.
- DMARC aggregate report handling: parse the reports into a table and summarize, or document a recommended third-party service (adding a paid one is stop-and-ask).
- `docs/RUNBOOK.md` covering how to:
  - onboard domains,
  - unpause a domain,
  - handle an SES account review,
  - rotate credentials,
  - restore from backup,
  - remove a domain cleanly (SES identities, DNS records, data retention).

**Accept when:** the owner can answer "is anything on fire?" from one page, and the runbook covers each listed procedure.

---

## 9. Testing

### 9.1 SES mailbox simulator

Use the SES simulator addresses for automated and manual send tests. Confirm the current list in the SES docs; it includes `success@`, `bounce@`, `complaint@`, `suppressionlist@`, and `ooto@` at `simulator.amazonses.com`. Simulator sends don't count against reputation.

### 9.2 Test domains

The owner will designate a small set of test domains (`<TEST_DOMAINS>`). Until those are provided, use `--dry-run` only. Real DNS changes and real sends to external test inboxes are allowed **only** on the test domains and **only** to addresses the owner provides.

### 9.3 What must have automated tests

- MIME parsing (multipart, inline images, odd encodings, missing headers).
- Threading.
- Role routing and catch-all.
- DNS record generation from SES responses.
- Conflict detection.
- Suppression checks.
- Unsubscribe token signing and verification.
- Warm-up cap math.
- Auto-pause thresholds.
- SNS signature verification (with fixture messages).

---

## 10. Security and data handling

- **Webhooks** accept only verified SNS messages, and processing is idempotent (keyed on the SNS MessageId or the SES message ID).
- **Least-privilege IAM.** The app's credentials can send email, read and write its S3 prefixes, and nothing else. The onboarding CLI uses separate, broader credentials that run locally or in CI, never in the web app.
- **S3:** keep the bucket private, use server-side encryption, and serve objects only through signed URLs. Lifecycle rules apply to raw inbound mail (e.g. move to infrequent access after 90 days). The retention period is an owner decision; flag it in `STATUS.md`.
- **Inbound HTML** is always sanitized and rendered in a sandboxed iframe with no scripts. Remote images are blocked by default.
- **Public endpoints** (signup, unsubscribe, confirm) are rate-limited, and their tokens are signed and time-limited where appropriate. Unsubscribe tokens don't expire.
- **Audit log** entries are written for all sends, status changes, imports, onboarding runs, pauses, and settings changes.
- **Backups:** confirm that the database host has point-in-time recovery enabled, and document it in the runbook.

---

## 11. Cost awareness

Expected cost drivers, for context only; verify current pricing:

- SES at roughly $0.10 per 1,000 emails, plus small inbound and data charges.
- S3 storage.
- The Postgres host.
- The queue service.
- Vercel.

Domain registrations are separate and owned by the business.

Design so that cost scales with **email volume**, not with domain count. For example, use one receipt rule rather than one per domain, and avoid per-domain paid resources. Any per-domain or recurring paid resource is stop-and-ask.

---

## 12. Out of scope (unless the owner adds it)

- Per-town staff accounts or per-town permissions.
- A self-hosted MTA, or any email provider other than SES.
- Dedicated IPs, or multiple AWS/SES accounts. These may come later; the risk in §7.2 is the reason. Note in `STATUS.md` if volume suggests they're needed.
- Open and click tracking (§3 item 13).
- AI-drafted replies, auto-replies, or autoresponders.
- Mobile apps.
- Migrating domains away from Vercel DNS.
- Editing the news websites themselves, beyond supplying an embeddable signup form or snippet.

---

## 13. Owner inputs needed

Track these in `docs/STATUS.md` and ask for them when they block progress:

- [ ] `<HQ_DOMAIN>` (the company Google Workspace domain)
- [ ] AWS account access, and the chosen SES region
- [ ] SES production access request (the owner submits it; you draft the use-case text)
- [ ] A Vercel API token with DNS scope, and the team ID
- [ ] Test domains (`<TEST_DOMAINS>`) and external test inbox addresses
- [ ] The DMARC report address
- [ ] The postal address for newsletter footers
- [ ] Initial team names and the role-to-team mapping (e.g. `sales` → Sales, `admin` → Admin, catch-all → Admin)
- [ ] The staff allow-list (about 6 people)
- [ ] The raw mail retention period
- [ ] Whether EU or Canadian subscribers are expected
