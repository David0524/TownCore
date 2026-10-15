import { App } from 'aws-cdk-lib';
import { MailStack, type MailEnvironment } from '../src/mail-stack';

// `pnpm --filter @towncore/infra deploy -c env=dev` (see docs/mail/RUNBOOK.md). Uses the
// operator's own AWS credentials and the region from AWS_REGION / the AWS profile.
const app = new App();
const mailEnv = (app.node.tryGetContext('env') ?? 'dev') as MailEnvironment;
if (mailEnv !== 'dev' && mailEnv !== 'prod') throw new Error(`Unknown env ${String(mailEnv)}`);
const webhookBaseUrl = app.node.tryGetContext('webhookBaseUrl') as string | undefined;

new MailStack(app, `TownCoreMail-${mailEnv}`, {
  mailEnv,
  webhookBaseUrl,
  env: {
    // Set by the CDK CLI from the operator's AWS profile; not app config (rule 11 covers secrets).
    /* eslint-disable no-restricted-properties */
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
    /* eslint-enable no-restricted-properties */
  },
  description: `TownCore mail platform (${mailEnv}): S3, SNS, SES configuration sets, IAM`,
});
