import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { envSchema, loadEnv, requireEnv } from '../src/env';

const envExamplePath = fileURLToPath(new URL('../../../.env.example', import.meta.url));

function envExampleKeys(): string[] {
  return readFileSync(envExamplePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0]!);
}

describe('env', () => {
  it('.env.example lists exactly the variables in the schema', () => {
    expect(envExampleKeys().sort()).toEqual(Object.keys(envSchema.shape).sort());
  });

  it('.env.example parses', () => {
    const values = Object.fromEntries(
      readFileSync(envExamplePath, 'utf8')
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const [key, ...rest] = line.split('=');
          return [key!, rest.join('=')];
        }),
    );
    expect(() => loadEnv(values)).not.toThrow();
  });

  it('treats empty strings as unset', () => {
    expect(loadEnv({ ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('parses ADMIN_EMAILS into a normalized list', () => {
    expect(loadEnv({ ADMIN_EMAILS: 'A@towncore.net, b@towncore.net' }).ADMIN_EMAILS).toEqual([
      'a@towncore.net',
      'b@towncore.net',
    ]);
    expect(() => loadEnv({ ADMIN_EMAILS: 'not-an-email' })).toThrow();
  });

  it('requireEnv throws a helpful error when missing', () => {
    expect(() => requireEnv('STRIPE_SECRET_KEY', loadEnv({}))).toThrow(/STRIPE_SECRET_KEY/);
    expect(requireEnv('DATABASE_URL', loadEnv({ DATABASE_URL: 'postgres://x@localhost/db' }))).toBe(
      'postgres://x@localhost/db',
    );
  });
});
