# Mail runbook

How to run the mail platform (`docs/plans/MAIL.md`). Start every incident at **Admin → Mail
health**: it lists what is wrong, and each alert names the section below to follow.

## Owner setup checklist

Do these once. Values go into the hosting dashboards (Vercel, Railway), never into git.

- [x] **Company Google domain:** towncore.net (set in `packages/config/src/publisher.ts`).
- [ ] **Google OAuth client** for staff sign-in. Google Cloud console → APIs & Services →
      Credentials → Create OAuth client ID → Web application.
  - Authorized redirect URI: `{APP_BASE_URL}/admin/auth/google/callback` (and
    `http://localhost:3000/admin/auth/google/callback` for local testing).
  - OAuth consent screen: **Internal** (Workspace users only).
  - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together. Once either is set, email-link
    sign-in turns off; if only one is set, sign-in is off entirely and the login page names
    what's missing.
  - The first admins come from `ADMIN_EMAILS`. After that, add staff in the database (an admin
    page comes later). Deactivate someone by setting `staff.active = false`; their sessions
    stop working at once.
- [ ] **AWS account** and the SES region. Recommended: `us-east-1` (it supports receiving).
- [ ] **SES production access.** Requested by the owner in the SES console; Claude drafts the
      use-case text. Until then SES only sends to verified addresses, 200 a day.
- [ ] **Vercel API token** with DNS scope (`VERCEL_DNS_TOKEN`) and the team ID (`VERCEL_TEAM_ID`).
- [ ] **Test domains** (3) and external test inbox addresses.
- [ ] **DMARC report address** (`DMARC_REPORT_ADDRESS`). Recommended: `dmarc@` on a town domain
      we receive mail for, e.g. `dmarc@bocatownsquare.com`. Reports to it are parsed into Admin →
      Mail health instead of the inbox. An address on another domain needs that domain to
      publish a `*._report._dmarc` TXT record with `v=DMARC1`.
- [ ] **towncore.net in SES** for staff mail (alerts, sign-in links): verify `towncore.net` as an
      SES identity (Easy DKIM CNAMEs in its DNS) so `alerts@towncore.net` can send. Until then
      alerts show only on the health page and in the worker log.
- [ ] **Database backups on Railway** (before real subscribers; see "Restoring from backup").
- [ ] **Postal address** for newsletter footers (`MAIL_POSTAL_ADDRESS`).
- [ ] **Seed inboxes for the placement test** (`PLACEMENT_SEED_ADDRESSES`): 4–6 company-held
      accounts, one each at Gmail, Outlook.com, Yahoo and iCloud (plus a Google Workspace and a
      Microsoft 365 mailbox if you have them). Open each once and leave its filters at defaults.
- [ ] **Teams and role mapping.** Defaults: `admin@`, `billing@`, `privacy@` → Admin; `sales@`,
      `advertise@` → Sales; `news@`, `editor@`, `tips@`, `corrections@` → Editorial; anything
      else → Admin.
- [ ] **Staff allow-list** (about 6 people).
- [ ] **Raw mail retention period.** Until decided, mail moves to S3 Infrequent Access after 90
      days and is never deleted.
- [ ] **EU or Canadian subscribers expected?** (GDPR / CASL.)

## Deploying the AWS infrastructure

`packages/infra` defines one CloudFormation stack per environment: `TownCoreMail-dev` and
`TownCoreMail-prod`. It holds the mail bucket, the SNS topics, the two SES configuration sets
(`towncore-{env}-conversational`, `towncore-{env}-bulk`), the app's IAM user and policy, and an
onboarding policy for operators. CI only synthesizes and tests it; deploys are run by hand.

```sh
# With your own AWS credentials (an admin profile), from the repo root:
export AWS_PROFILE=towncore-admin AWS_REGION=us-east-1
pnpm --filter @towncore/infra exec cdk bootstrap          # once per account and region
pnpm --filter @towncore/infra exec cdk diff -c env=dev     # review first
pnpm --filter @towncore/infra exec cdk deploy -c env=dev   # asks before IAM changes
```

After the deploy:

1. Copy the stack outputs into the app's environment: `MailBucketName` → `MAIL_S3_BUCKET`,
   `ConversationalConfigSet` → `SES_CONFIG_SET_CONVERSATIONAL`, `BulkConfigSet` →
   `SES_CONFIG_SET_BULK`.
2. In the IAM console, create an access key for the `AppUserName` user. Put it in
   `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for the web app and the worker.
3. Attach the `towncore-{env}-onboarding` policy to the IAM user or role that runs the
   onboarding CLI. Never give it to the app.

### Turning on inbound mail

1. Deploy the receiving environment with both flags:
   `cdk deploy -c env=prod -c receiving=true -c webhookBaseUrl=https://<admin host>`.
   `receiving=true` makes this stack's catch-all rule set the account's **active** one; only
   one environment per AWS account and region can receive mail, so never pass it for two
   stacks in the same account and region.
2. Put the three topic ARNs (`InboundTopicArn` plus the two event topics, from the stack's
   resources) in `MAIL_SNS_TOPIC_ARNS` for the web app, and redeploy it. The webhook refuses
   any other topic.
3. SNS sends a subscription confirmation to `/api/mail/sns`; the app verifies and confirms it
   by itself. Check the subscription shows **Confirmed** in the SNS console.
4. The worker needs `MAIL_S3_BUCKET` and the app AWS key to read raw mail. It polls stored
   notifications every 5 seconds.

### How inbound mail flows

SES → raw message to `s3://<bucket>/inbound/<id>` and a notice to the inbound topic → SNS →
`/api/mail/sns` (verified, stored once in `mail_events`) → worker: fetch, parse, sanitize, route
by envelope recipient, thread, store. Failed events retry with backoff (1, 2, 4 … minutes) and
are marked `failed` after 8 attempts; `select * from mail_events where status = 'failed'` shows
them with their last error. To retry one, set `status = 'pending', attempts = 0,
next_attempt_at = now()`.

Mail to a domain that isn't live for inbound is dropped (`mail_events.status = 'dropped'`, the
reason in `last_error`). Spam (SES verdict FAIL) starts in the spam folder; viruses are kept
quarantined and their attachments are never extracted.

### Sending replies and new messages

Staff send from the thread page (Reply / Reply all) or from **New message**
(`/admin/mail/compose`). Pressing Send is the Rule 10 approval for that one message (D-MAIL-11).
Mail goes out through the conversational configuration set, from the town address, with the
sender's signature. `MAIL_TRANSPORT=log` (development, CI) writes the message to the server log
instead and marks it `logged`; production uses SES (the default whenever AWS credentials are
set).

Delivery status on each sent message follows SES events (sent → delivered, delayed, bounced,
complained, rejected). A hard bounce or complaint adds a suppression; sending to a suppressed
address asks for a "Send anyway" confirmation. Failed sends are marked `failed` with the SES
error, and the draft is kept.

**First live check (once SES production access is granted):** reply from a test domain to an
outside mailbox, reply to that again, and confirm the answer lands in the same thread. SES
replaces our Message-ID, so threading depends on the stored SES ids (`messages.rfc_message_id`
and `alt_message_ids`); if the reply opens a new thread, compare its `In-Reply-To` with those.

## Rotating credentials

- **App AWS key:** create a second access key for the app user, update it in Vercel and
  Railway, redeploy both, then delete the old key.
- **Google client secret:** add a new secret on the OAuth client, update `GOOGLE_CLIENT_SECRET`,
  redeploy, then delete the old secret.
- **`MAIL_TOKEN_SECRET`:** _(Mail-5)_ unsubscribe links in sent mail must keep working, so
  rotation will keep the old secret valid for verification.

## Onboarding domains

`pnpm mail:onboard` creates each domain's two SES identities (root and `news.`, each with Easy
DKIM and a custom MAIL FROM) and its 14 email DNS records on Vercel, waits for SES to verify,
then marks the domain live for inbound and warming for bulk mail (50 a day to start).

```sh
pnpm mail:onboard add testtown.com                 # dry-run: prints every change, makes none
pnpm mail:onboard add testtown.com --execute       # applies it (test domains only)
pnpm mail:onboard add --from-file domains.txt --execute --approved   # owner-approved batch
pnpm mail:onboard status [domain]                  # per-step progress and failures
pnpm mail:onboard verify-all --execute             # finish domains waiting on SES
pnpm mail:onboard retry testtown.com --execute     # after fixing whatever failed
```

- **Dry-run is the default.** Without a Vercel token or AWS credentials it runs offline,
  assuming an empty zone and no identities, so the plan can be reviewed before access exists.
- **Guard.** `--execute` changes only domains in `MAIL_TEST_DOMAINS`. Anything else, including
  any batch with a non-test domain, needs `--approved`, which means the owner signed off.
- **Town domains** take their From name from the town's `site_name`. Other domains need
  `--display-name "Name"`.
- **Needs** `VERCEL_DNS_TOKEN`, `VERCEL_TEAM_ID`, the operator's AWS credentials (with the
  `towncore-{env}-onboarding` policy), `AWS_REGION`, `DMARC_REPORT_ADDRESS` and both
  `SES_CONFIG_SET_*` values.
- **It never overwrites a record.** If the domain already has a different MX, SPF, DMARC, or a
  record where a CNAME must go, the domain is marked `failed` with the clash spelled out, nothing
  is changed, and the other domains carry on. Resolving a conflict is the owner's call (for
  example, a domain that already receives mail elsewhere). Fix it in Vercel, then run `retry`.
- **Safe to re-run.** Each step records its status in `onboarding_steps`; a crashed or
  interrupted run resumes where it stopped, a finished domain is a no-op, and two runs never
  work on one domain at once (a 15-minute lease on `mail_domains`).
- **Verification** usually takes minutes but can take up to 72 hours. Domains waiting on SES
  show as `onboarding`. The worker checks them every 5 minutes and takes them live once SES
  verifies (it only reads SES, with the app's credentials); `verify-all` does the same by hand.
  **Admin → Mail domains** shows each domain's identities, records and steps, and its
  "Re-check SES status" button asks the worker to look again on its next tick. If SES gives up (DKIM or MAIL FROM `FAILED`),
  the domain fails with the reason; check the records in Vercel, then `retry`.

### Warm-up starts when we buy the domain

Every town domain starts building its sending reputation as soon as we own it (owner,
2026-10-17). Nobody has to remember to onboard it:

1. **Bought.** `pnpm launch … --approve-spend` buys the domain (step 2, Rule 10: typed back at
   the quoted price). That approval also covers its mail onboarding, so no `--approved` is needed
   and the `MAIL_TEST_DOMAINS` limit doesn't apply to it.
2. **Onboarded.** Step 2b ("Mail domain and warm-up") runs right after the purchase: the two
   SES identities, DKIM, MAIL FROM, and the SPF, DMARC and MX records on Vercel. It never
   overwrites a record; a conflict becomes a launch to-do (and a line in
   `docs/launch-friction.md`), and the launch carries on.
3. **Verified.** The worker's 5-minute check takes the domain live once SES sees the DNS, and
   warm-up starts at 50 emails a day, doubling every 3 healthy days.
4. **Warming in draft.** Staff test issues (Admin → Newsletter, test mode) and `news@` replies
   go out from the domain while the site is still a draft. That's real mail to real people who
   asked for it, which is how reputation is built.
5. **Launch.** Sign-up opens with the site; confirmations and the first daily issues grow within
   the day's cap, and anything over it waits for the next day.

Plan ahead by cohort: pass `--cohort 2026-12` (the planned go-live month) to `pnpm launch`, and
buy each cohort's domains at least three weeks (`MAIL_LEAD_DAYS`, 21) before that month, so
they're verified and warming at go-live. The launch report shows the date onboarding should
start by.

**Catching up.** If onboarding couldn't run at purchase (credentials not set yet, a conflict,
an API error), the launch report lists it as a to-do and Mail health raises
"bought … but its mail onboarding hasn't started" an hour after the purchase. Then:

```sh
pnpm mail:onboard bought             # dry-run: every bought domain, soonest cohort first
pnpm mail:onboard bought --execute   # onboards the ones not yet onboarded (or failed)
```

A resumed launch (`pnpm launch … --resume`) also retries its own step 2b.

**Never** use paid "warm-up networks" or seed lists that trade fake mail. They break the SES
terms and Google's sender rules, and they put the whole account at risk. Rule 10 is unchanged:
the daily newsletter still needs its per-town standing approval (off → test → live after 3 test
issues), campaigns need "Approve send", and replies need a person to press Send.

## Newsletters and bulk mail

**Before a town takes signups**, all of these must hold (otherwise its site keeps saying
"launching soon"):
- its mail domain is `live` and bulk is `warming` or `active` (onboarding sets `warming`);
- `SES_CONFIG_SET_BULK`, `MAIL_TOKEN_SECRET` and a postal address (`MAIL_POSTAL_ADDRESS`, or
  the domain's own) are set;
- bulk mail isn't paused for every town.

**Sending.** Staff write campaigns in Admin → Campaigns (Markdown, with `{{site_name}}`,
`{{town_name}}` and `{{domain}}`). "Send a test to me" goes only to the person pressing it. An
admin presses "Approve send" (Rule 10), now or at a UTC time; the worker then sends in batches
under the domain's daily cap. Templates make one draft per chosen town. The daily newsletter
(M5) is managed in Admin → Newsletter (see "The daily newsletter" below).

**Warm-up.** New domains start at 50 a day; the cap doubles every 3 healthy days up to the
target (50,000 by default). A day over the thresholds holds the ramp; two in a row step it back.
Sends over the cap wait for the next UTC day and go first.

**Imports** need the owner's approval and a written consent source:

```sh
pnpm mail:import --town boca-raton --file list.csv --consent-source "Signed up at the 2026 street fair"
# Dry run: prints what it would add. Then, once the owner approves the list:
pnpm mail:import --town boca-raton --file list.csv --consent-source "…" --approved-by owner@towncore.net
```

Only an active admin can approve. Existing subscribers are never changed; the import is audited.

## The daily newsletter (M5)

Each town's issue is built by the worker once its local `newsletter_send_time` passes (one issue
per town and local date; a retried tick never sends twice). It holds the weather, 5–8 new
stories in homepage rank order, public meetings in the next 7 days, any corrections, and at most
one paid unit. A day with fewer than 3 new stories and no weather alert is skipped, and those
stories wait for the next issue. More than 3 hours late, the day is skipped.

Admin → Newsletter → a town:
1. **Test list.** Add the staff who should get test issues.
2. **"Send to the test list"** (admin): daily issues go only to the test list, marked "[Test]".
3. Read at least 3 test issues (the page counts them). "Send a test to me" sends the next issue
   as it would look now, to you only.
4. **"Go live"** (admin; needs 3 test issues): daily issues go to every active subscriber through
   the bulk sender, under the warm-up cap. This is the standing approval (D-MAIL-11) and is
   audited. "Send to the test list" or "Turn off" withdraws it at once.

Past issues show their subject, content and counts (sent, delivered, bounced, complained; no
opens are tracked).

## Unpausing a domain

The worker pauses a domain's bulk mail when, over the last 7 days and at least 100 sends,
bounces pass 3% or complaints pass 0.08%. Its sending campaigns pause too; replies are never
paused. The reason is shown on the domain's page.

1. Find out why: look at the bounce and complaint events for the domain (`email_events` with
   its `domain_id`) and the campaigns sent in that week.
2. Fix the cause (a bad import, a broken signup form, content people report as spam).
3. An admin presses "Unpause bulk mail" on the domain page. It goes back to warming (or active
   if its ramp had finished); paused campaigns are resumed one by one from their pages.

If all mail together passes 4% bounces or 0.08% complaints, bulk mail pauses for every town
(Admin → Campaigns shows the reason). SES reviews accounts at 5% and 0.1%, so treat this as
urgent: find the cause before an admin presses "Resume bulk mail for every town".

## Inbox-placement test before go-live

On a domain's page (Admin → Mail domains → the domain), **Send placement test** sends one copy
of the town's real morning email (its latest newsletter or campaign, else a short sample) from
`newsletter@news.<domain>` to each seed inbox in `PLACEMENT_SEED_ADDRESSES`, and to nobody else.
It's a measurement, not warm-up: a fixed handful of our own accounts, once a domain a day,
tagged as its own `placement` stream so it never counts in the domain's bulk rates.

1. Send the test once the domain is live and warming, a few days before go-live.
2. Open each seed inbox, find the copy (it ends "Placement check" and the test's code) and press
   Inbox, Promotions, Spam or Missing beside that seed. Promotions counts as delivered.
3. Admin → Launches shows the latest result beside the warm-up. It informs go-live, it doesn't
   block it. Anything in spam or missing: check the domain's DKIM and DMARC records and its
   DMARC reports, look at the content, and test again the next day.

## Stepping up the DMARC policy

Onboarding writes `_dmarc` and `_dmarc.news` at `p=none`, so receivers only report. Admin →
Mail health (and each domain's page) shows every DMARC record with its policy and whether its
reports say it can go one step stricter: reports on at least 14 days, at least 200 messages and
99% passing DMARC in the last 30 days, the newest report within 7 days, and for reject, 30 days
at quarantine judged on reports from after that change.

When a record is ready an admin presses **Move to quarantine** (later **Move to reject**). The
admin writes the new TXT record on Vercel, then deletes the old one, so a failure leaves the old
policy in place; the change is audited. **Back to none** is always one press away if real mail
starts failing. Only records onboarding created are changed this way; a record that was already
there is marked "change it at the DNS host". Needs `VERCEL_DNS_TOKEN` and AWS credentials.
Onboarding re-runs keep a stepped-up policy as it is.

## Handling an SES account review

SES reviews the whole account at about **5% bounces** or **0.1% complaints** and may pause
sending at 10% / 0.5%. All towns share the account, so a review affects replies too. Mail health
shows the account's status (HEALTHY, PROBATION or SHUTDOWN), checked every 15 minutes, and
alerts when it isn't HEALTHY or when rates reach 3% / 0.06%.

1. **Stop the damage.** Bulk mail for every town pauses automatically at 4% / 0.08%. If it
   hasn't, pause the worst domains: Admin → Mail health shows each domain's bulk bounce and
   complaint rates.
2. **Find the cause.** Usually one town: a bad import, a signup form bots got past, or a
   campaign people marked as spam. Check that domain's recent campaigns and the
   `email_events` rows behind its numbers.
3. **Fix it.** Suppress or remove the bad addresses, fix the form, stop the campaign. Hard bounces
   and complaints are already suppressed automatically.
4. **Answer AWS.** The SES console (Account dashboard) shows the review case. Reply with what
   happened, what was fixed and how it's prevented (double opt-in, suppression list,
   per-domain auto-pause, warm-up). Keep bulk paused until the account is HEALTHY again.
5. **Resume slowly.** Unpause one domain at a time (see "Unpausing a domain") and watch its rates
   for a day before the next.

## Restoring from backup

Postgres runs on Railway (D-MAIL-10). Turn on all three layers before real subscribers:

- **Volume backups:** Postgres service → Backups → schedule daily backups. A restore replaces
  the same service's data; use it for a broken volume.
- **Point-in-time recovery (PITR):** Postgres service → Backups → Enable PITR. Railway archives
  every WAL segment (pgBackRest) to a bucket it creates, `Postgres-PITR`. A restore to any time
  in the retention window creates a **new sibling Postgres service**; the original is never
  touched. Railway's docs note that PITR needs the official Postgres image pinned to a major
  version (not `:latest`), and that a long storage outage can drop WAL and shorten the window.
- **Logical dumps:** a nightly `pg_dump` to storage outside Railway, so we can leave Railway or
  copy one table back by hand.

To recover from a mistake (for example a bad import or a mass update):
1. Note the time just before it happened (UTC).
2. Restore PITR to that time. Railway creates a new Postgres service beside the old one.
3. Stop the worker. Point `DATABASE_URL` for the web app and the worker at the new service,
   redeploy both, and start the worker again.
4. Check Admin → Mail health and the subscriber counts. Keep the old service until you're sure,
   then delete it.

Raw mail and attachments live in S3, not Postgres, so a restore never loses them; messages
received after the restore point come back by re-processing their `mail_events` (set them to
`pending`).

## Removing a domain cleanly

```sh
pnpm mail:onboard remove boca-example.com            # dry run: lists what would be deleted
pnpm mail:onboard remove boca-example.com --execute  # add --approved outside MAIL_TEST_DOMAINS
```

It deletes only what onboarding created: the DNS records it wrote (by their Vercel record ids)
and the two SES identities (`domain` and `news.domain`). Records the domain had before us are
never touched. The domain is then marked `removed`: inbound mail off, bulk paused, newsletter
off. Running it again is harmless; running `add` later starts onboarding from scratch.

It needs the operator credentials (Vercel token, AWS keys with `ses:DeleteEmailIdentity`), like
onboarding. Afterwards:
- **Data:** conversations, subscribers and campaign history stay in Postgres; raw mail stays in
  S3 under the bucket's lifecycle rules. Delete subscriber rows only on a person's request
  (Privacy page) or when the owner sets a retention period.
- **DMARC:** reports for the domain stop arriving within a few days.
- **The town site:** removing mail doesn't touch the site or its domain registration.
