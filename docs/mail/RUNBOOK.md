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

Once the SNS webhook exists (Mail-2), redeploy with `-c webhookBaseUrl=https://<admin host>` to
subscribe the app to every topic.

## Rotating credentials

- **App AWS key:** create a second access key for the app user, update it in Vercel and
  Railway, redeploy both, then delete the old key.
- **Google client secret:** add a new secret on the OAuth client, update `GOOGLE_CLIENT_SECRET`,
  redeploy, then delete the old secret.
- **`MAIL_TOKEN_SECRET`:** _(Mail-5)_ unsubscribe links in sent mail must keep working, so
  rotation will keep the old secret valid for verification.

## Onboarding domains _(Mail-1)_

## Unpausing a domain _(Mail-5)_

## Handling an SES account review _(Mail-6)_

## Restoring from backup _(Mail-6)_

Before real subscribers exist, confirm the Railway Postgres backup and point-in-time-restore
options and record them here (D-MAIL-10).

## Removing a domain cleanly _(Mail-6)_
