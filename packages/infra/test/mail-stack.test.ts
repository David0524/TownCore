import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MailStack } from '../src/mail-stack';

const env = { account: '123456789012', region: 'us-east-1' };
const synth = (props: { webhookBaseUrl?: string } = {}) =>
  Template.fromStack(new MailStack(new App(), 'Test', { mailEnv: 'dev', env, ...props }));

describe('MailStack', () => {
  const template = synth();

  it('keeps raw mail in a private, encrypted, TLS-only bucket that survives stack deletion', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        },
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Prefix: 'inbound/',
              Transitions: [{ StorageClass: 'STANDARD_IA', TransitionInDays: 90 }],
            }),
          ]),
        },
      },
    });
    // Nothing expires until the owner sets a retention period.
    const rules = Object.values(template.findResources('AWS::S3::Bucket'))[0]!.Properties
      .LifecycleConfiguration.Rules as Record<string, unknown>[];
    expect(rules.every((rule) => rule.ExpirationInDays === undefined)).toBe(true);
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Sid: 'AllowSesInbound',
            Principal: { Service: 'ses.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': '123456789012' } },
          }),
        ]),
      },
    });
  });

  it('has two configuration sets with suppression on and no open or click tracking', () => {
    template.resourceCountIs('AWS::SES::ConfigurationSet', 2);
    for (const name of ['towncore-dev-conversational', 'towncore-dev-bulk']) {
      template.hasResourceProperties('AWS::SES::ConfigurationSet', {
        Name: name,
        SuppressionOptions: { SuppressedReasons: ['BOUNCE', 'COMPLAINT'] },
        TrackingOptions: Match.absent(),
      });
    }
    const destinations = template.findResources('AWS::SES::ConfigurationSetEventDestination');
    expect(Object.keys(destinations)).toHaveLength(2);
    for (const resource of Object.values(destinations)) {
      const types = resource.Properties.EventDestination.MatchingEventTypes as string[];
      expect(types).toEqual(expect.arrayContaining(['bounce', 'complaint', 'delivery', 'reject']));
      expect(types).not.toContain('open');
      expect(types).not.toContain('click');
    }
  });

  it('has an inbound topic and one event topic per stream, with no webhook until asked', () => {
    template.resourceCountIs('AWS::SNS::Topic', 3);
    template.resourceCountIs('AWS::SNS::Subscription', 0);
    synth({ webhookBaseUrl: 'https://admin.example/' }).resourcePropertiesCountIs(
      'AWS::SNS::Subscription',
      { Protocol: 'https', Endpoint: 'https://admin.example/api/mail/sns' },
      3,
    );
  });

  it('gives the app least-privilege credentials', () => {
    const policies = template.findResources('AWS::IAM::ManagedPolicy', {
      Properties: { ManagedPolicyName: 'towncore-dev-app' },
    });
    const statements = Object.values(policies)[0]!.Properties.PolicyDocument.Statement as {
      Action: string | string[];
      Resource: unknown;
    }[];
    const actions = statements.flatMap((s) => [s.Action].flat());
    expect(actions.sort()).toEqual(
      [
        's3:GetObject',
        's3:GetObject',
        's3:PutObject',
        'ses:GetAccount',
        'ses:GetEmailIdentity',
        'ses:SendEmail',
        'ses:SendRawEmail',
      ].sort(),
    );
    expect(actions.some((a) => a.endsWith('*'))).toBe(false);
    // Creating or changing identities belongs only to the operator's onboarding policy.
    expect(actions.filter((a) => a.includes('Identity'))).toEqual(['ses:GetEmailIdentity']);
  });

  it('names resources per environment so dev and prod never collide', () => {
    const prod = Template.fromStack(new MailStack(new App(), 'P', { mailEnv: 'prod', env }));
    prod.hasResourceProperties('AWS::SES::ConfigurationSet', { Name: 'towncore-prod-bulk' });
    prod.hasResourceProperties('AWS::IAM::User', { UserName: 'towncore-prod-app' });
  });
});
