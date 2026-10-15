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
  EMAIL_PROVIDER_KEY: optional(z.string()),
  STRIPE_SECRET_KEY: optional(z.string()),
  STRIPE_WEBHOOK_SECRET: optional(z.string()),
  CLOUDFLARE_API_TOKEN: optional(z.string()),
  REGISTRAR_API_KEY: optional(z.string()),
  HOSTING_API_TOKEN: optional(z.string()),
  APP_BASE_URL: optional(z.url().refine((url) => !url.endsWith('/'), 'no trailing slash')),
  ADMIN_EMAILS: optional(
    z
      .string()
      .transform((list) => list.split(',').map((email) => email.trim().toLowerCase()))
      .pipe(z.array(z.email())),
  ),
  DEV_TOWN_SLUG: optional(z.string().regex(/^[a-z0-9-]+$/)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

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
