import { z } from 'zod';

// The only module allowed to read process.env (enforced by ESLint).
// Every variable is optional here; code that needs one calls requireEnv() so a
// missing secret fails loudly at boot instead of in the middle of a job.

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

export const envSchema = z.object({
  DATABASE_URL: optional(z.url({ protocol: /^postgres(ql)?$/ })),
  ANTHROPIC_API_KEY: optional(z.string()),
  GEMINI_API_KEY: optional(z.string()),
  // Which model provider the pipeline uses. Unset: Anthropic if its key is set, else Gemini.
  LLM_PROVIDER: optional(z.enum(['anthropic', 'gemini'])),
  STRIPE_SECRET_KEY: optional(z.string()),
  STRIPE_WEBHOOK_SECRET: optional(z.string()),
  REGISTRAR_API_KEY: optional(z.string()),
  REGISTRANT_FIRST_NAME: optional(z.string()),
  REGISTRANT_LAST_NAME: optional(z.string()),
  REGISTRANT_EMAIL: optional(z.string()),
  REGISTRANT_PHONE: optional(z.string()),
  REGISTRANT_ADDRESS1: optional(z.string()),
  REGISTRANT_CITY: optional(z.string()),
  REGISTRANT_STATE: optional(z.string()),
  REGISTRANT_ZIP: optional(z.string()),
  REGISTRANT_COUNTRY: optional(z.string()),
  REGISTRANT_COMPANY: optional(z.string()),
  HOSTING_API_TOKEN: optional(z.string()),
  APP_BASE_URL: optional(z.url().refine((url) => !url.endsWith('/'), 'no trailing slash')),
  ADMIN_EMAILS: optional(
    z
      .string()
      .transform((list) => list.split(',').map((email) => email.trim().toLowerCase()))
      .pipe(z.array(z.email())),
  ),
  // Mail platform (docs/plans/MAIL.md). AWS credentials are also read by the AWS SDK itself.
  AWS_REGION: optional(z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/)),
  AWS_ACCESS_KEY_ID: optional(z.string()),
  AWS_SECRET_ACCESS_KEY: optional(z.string()),
  MAIL_S3_BUCKET: optional(z.string()),
  // Where reader and business photos are kept without S3 (development and CI; docs/plans/M9.md).
  PHOTO_STORAGE_DIR: optional(z.string()),
  // Set by Vercel itself on its deployments (never in .env): its disk doesn't keep photos, and
  // with no worker there, town pages refresh stale weather themselves (apps/web/src/lib/weather.ts).
  VERCEL: optional(z.string()),
  // How outbound mail leaves: 'ses', or 'log' (development and CI: written to the server log,
  // never sent). Unset: SES when AWS credentials are set, otherwise sending is off.
  MAIL_TRANSPORT: optional(z.enum(['ses', 'log'])),
  SES_CONFIG_SET_CONVERSATIONAL: optional(z.string()),
  SES_CONFIG_SET_BULK: optional(z.string()),
  // Owner-designated test domains: the only ones onboarding may change without --approved.
  MAIL_TEST_DOMAINS: optional(
    z.string().transform((list) =>
      list
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  ),
  // SNS topics the mail webhook accepts (packages/infra outputs); anything else is refused.
  MAIL_SNS_TOPIC_ARNS: optional(
    z
      .string()
      .transform((list) =>
        list
          .split(',')
          .map((arn) => arn.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().regex(/^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:[\w-]+$/))),
  ),
  VERCEL_DNS_TOKEN: optional(z.string()),
  VERCEL_TEAM_ID: optional(z.string()),
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),
  DMARC_REPORT_ADDRESS: optional(z.email()),
  MAIL_TOKEN_SECRET: optional(z.string().min(32)),
  MAIL_POSTAL_ADDRESS: optional(z.string()),
  UNSPLASH_ACCESS_KEY: optional(z.string()),
  DEV_TOWN_SLUG: optional(z.string().regex(/^[a-z0-9-]+$/)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Drops the cached parse, e.g. after loading a .env file into process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  if (source === process.env) cached = result.data;
  return result.data;
}

export function requireEnv<K extends keyof Env>(key: K, env: Env = loadEnv()): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null) {
    throw new Error(`Missing required environment variable ${key}. See .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}
