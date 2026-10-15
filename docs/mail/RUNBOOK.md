# Mail runbook

How to run the mail platform (`docs/plans/MAIL.md`). Each section is filled in by the phase that
builds it; sections marked _(Mail-N)_ are not built yet.

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
- [ ] **DMARC report address** (`DMARC_REPORT_ADDRESS`).
- [ ] **Postal address** for newsletter footers (`MAIL_POSTAL_ADDRESS`).
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

## Unpausing a domain _(Mail-5)_

## Handling an SES account review _(Mail-6)_

## Restoring from backup _(Mail-6)_

Before real subscribers exist, confirm the Railway Postgres backup and point-in-time-restore
options and record them here (D-MAIL-10).

## Removing a domain cleanly _(Mail-6)_
