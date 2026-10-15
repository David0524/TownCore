import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cr from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';

// AWS resources for the mail platform (docs/plans/MAIL.md; brief §5). One stack per environment,
// so dev and prod have separate buckets, topics and configuration sets. Per-domain resources
// (SES identities, DNS records) are created by the onboarding CLI, never here: cost and
// resource count scale with mail volume, not with the number of towns.
//
// Receiving: one catch-all receipt rule (no recipient conditions, so it covers every verified
// domain) writes raw mail to inbound/ and notifies the inbound topic. Only one rule set can be
// active per account and region, so only the stack deployed with `receiving` activates it.

export type MailEnvironment = 'dev' | 'prod';

export interface MailStackProps extends StackProps {
  mailEnv: MailEnvironment;
  /**
   * Base URL of the staff admin host (APP_BASE_URL). When set, every topic delivers to the
   * app's signed SNS webhook. Leave unset until that endpoint exists (Mail-2).
   */
  webhookBaseUrl?: string;
  /**
   * Make this stack's rule set the account's active one (`-c receiving=true`). Only one
   * environment per AWS account and region can receive mail.
   */
  receiving?: boolean;
}

/** Every sending event we track. Open and click are deliberately absent (brief §3 item 13). */
export const trackedEvents = [
  ses.EmailSendingEvent.SEND,
  ses.EmailSendingEvent.REJECT,
  ses.EmailSendingEvent.BOUNCE,
  ses.EmailSendingEvent.COMPLAINT,
  ses.EmailSendingEvent.DELIVERY,
  ses.EmailSendingEvent.DELIVERY_DELAY,
  ses.EmailSendingEvent.RENDERING_FAILURE,
];

export const INBOUND_PREFIX = 'inbound/';
export const ATTACHMENTS_PREFIX = 'attachments/';

export class MailStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly inboundTopic: sns.Topic;
  readonly conversational: ses.ConfigurationSet;
  readonly bulk: ses.ConfigurationSet;

  constructor(scope: Construct, id: string, props: MailStackProps) {
    super(scope, id, props);
    const name = (part: string) => `towncore-${props.mailEnv}-${part}`;

    // Raw mail and attachments: private, encrypted, TLS only, kept if the stack is deleted.
    // Retention is an owner decision; until then objects move to Infrequent Access after 90
    // days and are never expired.
    this.bucket = new s3.Bucket(this, 'MailBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [INBOUND_PREFIX, ATTACHMENTS_PREFIX].map((prefix) => ({
        id: `${prefix.replace('/', '')}-to-ia`,
        prefix,
        transitions: [
          { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(90) },
        ],
      })),
    });
    // SES receiving writes raw messages under inbound/, and only for this account.
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSesInbound',
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [this.bucket.arnForObjects(`${INBOUND_PREFIX}*`)],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );

    this.inboundTopic = new sns.Topic(this, 'InboundTopic', {
      topicName: name('inbound'),
      enforceSSL: true,
      // SHA-256 signatures; the webhook accepts v1 and v2 but v2 is what we ask for.
      signatureVersion: '2',
    });
    this.inboundTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSesInbound',
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.inboundTopic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );

    // Catch-all inbound rule: spam and virus scanning on, raw message to S3, notice to SNS.
    const ruleSet = new ses.ReceiptRuleSet(this, 'InboundRuleSet', {
      receiptRuleSetName: name('inbound'),
    });
    ruleSet.addRule('CatchAll', {
      receiptRuleName: name('catch-all'),
      scanEnabled: true,
      tlsPolicy: ses.TlsPolicy.OPTIONAL,
      actions: [
        new sesActions.S3({
          bucket: this.bucket,
          objectKeyPrefix: INBOUND_PREFIX,
          topic: this.inboundTopic,
        }),
      ],
    });
    if (props.receiving) {
      // CloudFormation has no resource for "active rule set"; set it through the SES API.
      const activate = {
        service: 'SES',
        action: 'setActiveReceiptRuleSet',
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: cr.PhysicalResourceId.of(`${name('inbound')}-active`),
      };
      new cr.AwsCustomResource(this, 'ActivateInboundRuleSet', {
        onCreate: activate,
        onUpdate: activate,
        // Deactivating stops all receiving for the account and region; leave that to a person.
        installLatestAwsSdk: false,
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({ actions: ['ses:SetActiveReceiptRuleSet'], resources: ['*'] }),
        ]),
      });
    }

    // Two sending streams, each with its own configuration set and event topic (D-MAIL-12).
    // The account-level suppression list stays on as a backstop; the app's own table decides.
    const stream = (key: 'conversational' | 'bulk') => {
      const topic = new sns.Topic(this, `${key}EventsTopic`, {
        topicName: name(`${key}-events`),
        enforceSSL: true,
        signatureVersion: '2',
      });
      const set = new ses.ConfigurationSet(this, `${key}ConfigSet`, {
        configurationSetName: name(key),
        reputationMetrics: true,
        sendingEnabled: true,
        suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
        tlsPolicy: ses.ConfigurationSetTlsPolicy.OPTIONAL,
      });
      set.addEventDestination(`${key}ToSns`, {
        destination: ses.EventDestination.snsTopic(topic),
        events: trackedEvents,
      });
      return { topic, set };
    };
    const conversational = stream('conversational');
    const bulk = stream('bulk');
    this.conversational = conversational.set;
    this.bulk = bulk.set;

    if (props.webhookBaseUrl) {
      const endpoint = `${props.webhookBaseUrl.replace(/\/$/, '')}/api/mail/sns`;
      for (const topic of [this.inboundTopic, conversational.topic, bulk.topic]) {
        topic.addSubscription(new subs.UrlSubscription(endpoint, { rawMessageDelivery: false }));
      }
    }

    // The app's credentials (web and worker): send through our two configuration sets, read
    // raw mail, write attachments, and read account and identity status. Nothing else (brief §10).
    const appPolicy = new iam.ManagedPolicy(this, 'AppPolicy', {
      managedPolicyName: name('app'),
      statements: [
        new iam.PolicyStatement({
          sid: 'SendThroughOurConfigSets',
          actions: ['ses:SendEmail', 'ses:SendRawEmail'],
          resources: [
            this.arn('ses', 'identity/*'),
            this.arn('ses', `configuration-set/${name('conversational')}`),
            this.arn('ses', `configuration-set/${name('bulk')}`),
          ],
        }),
        new iam.PolicyStatement({
          sid: 'ReadAccountStatus',
          actions: ['ses:GetAccount'],
          resources: ['*'],
        }),
        // The worker re-checks domain verification (Mail-1); it never creates or changes one.
        new iam.PolicyStatement({
          sid: 'ReadIdentityStatus',
          actions: ['ses:GetEmailIdentity'],
          resources: [this.arn('ses', 'identity/*')],
        }),
        new iam.PolicyStatement({
          sid: 'ReadInbound',
          actions: ['s3:GetObject'],
          resources: [this.bucket.arnForObjects(`${INBOUND_PREFIX}*`)],
        }),
        new iam.PolicyStatement({
          sid: 'ReadWriteAttachments',
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [this.bucket.arnForObjects(`${ATTACHMENTS_PREFIX}*`)],
        }),
      ],
    });
    const appUser = new iam.User(this, 'AppUser', { userName: name('app') });
    appUser.addManagedPolicy(appPolicy);

    // For the onboarding CLI, attached by hand to the operator's own IAM user or role. It
    // manages SES identities, so it never goes to the web app (brief §10).
    new iam.ManagedPolicy(this, 'OnboardingPolicy', {
      managedPolicyName: name('onboarding'),
      statements: [
        new iam.PolicyStatement({
          sid: 'ManageIdentities',
          actions: [
            'ses:CreateEmailIdentity',
            'ses:GetEmailIdentity',
            'ses:ListEmailIdentities',
            'ses:PutEmailIdentityMailFromAttributes',
            // Domain removal (Mail-6): only the operator's credentials can delete identities.
            'ses:DeleteEmailIdentity',
            'ses:PutEmailIdentityConfigurationSetAttributes',
            'ses:PutEmailIdentityDkimAttributes',
            'ses:TagResource',
          ],
          resources: ['*'],
        }),
      ],
    });

    const out = (key: string, value: string, description: string) =>
      new CfnOutput(this, key, { value, description });
    out('MailBucketName', this.bucket.bucketName, 'MAIL_S3_BUCKET');
    out('ConversationalConfigSet', name('conversational'), 'SES_CONFIG_SET_CONVERSATIONAL');
    out('BulkConfigSet', name('bulk'), 'SES_CONFIG_SET_BULK');
    out('InboundTopicArn', this.inboundTopic.topicArn, 'SNS topic for inbound mail (Mail-2)');
    out('AppUserName', appUser.userName, 'Create an access key for this user in the console');
  }

  private arn(service: string, resource: string): string {
    return `arn:${this.partition}:${service}:${this.region}:${this.account}:${resource}`;
  }
}
