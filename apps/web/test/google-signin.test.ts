import { createHash } from 'node:crypto';
import { loadEnv } from '@towncore/config';
import { describe, expect, it, vi } from 'vitest';
import {
  authorizationUrl,
  decodeAttempt,
  encodeAttempt,
  exchangeCode,
  GoogleSignInError,
  newAttempt,
  signInMode,
  verifyIdTokenClaims,
} from '../src/lib/admin/google';

const NOW = new Date('2026-10-15T12:00:00Z');
const expected = {
  clientId: 'client-1',
  hqDomain: 'towncore.net',
  nonce: 'n'.repeat(40),
  now: NOW,
};

function idToken(overrides: Record<string, unknown> = {}): string {
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'client-1',
    exp: NOW.getTime() / 1000 + 300,
    nonce: expected.nonce,
    email: 'Pat@TownCore.net',
    email_verified: true,
    hd: 'towncore.net',
    name: 'Pat Doe',
    ...overrides,
  };
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

describe('signInMode', () => {
  it('uses email links only when no Google variable is set', () => {
    expect(signInMode(loadEnv({}))).toEqual({ kind: 'email' });
  });

  it('fails closed on a partial Google setup', () => {
    expect(signInMode(loadEnv({ GOOGLE_CLIENT_ID: 'x' }))).toEqual({
      kind: 'misconfigured',
      missing: ['GOOGLE_CLIENT_SECRET'],
    });
  });

  it('uses Google when fully configured', () => {
    const env = loadEnv({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 's',
    });
    expect(signInMode(env)).toMatchObject({ kind: 'google', hqDomain: 'towncore.net' });
  });
});

describe('sign-in attempt', () => {
  it('round-trips through the cookie and rejects tampering', () => {
    const attempt = newAttempt();
    expect(decodeAttempt(encodeAttempt(attempt))).toEqual(attempt);
    expect(decodeAttempt(undefined)).toBeNull();
    expect(decodeAttempt('not-base64-json')).toBeNull();
    expect(decodeAttempt(encodeAttempt({ ...attempt, state: 'short' }))).toBeNull();
  });

  it('sends state, nonce, an S256 PKCE challenge and the hd hint', () => {
    const attempt = newAttempt();
    const url = new URL(
      authorizationUrl({ clientId: 'client-1', hqDomain: 'towncore.net' }, 'https://a/cb', attempt),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-1',
      redirect_uri: 'https://a/cb',
      response_type: 'code',
      scope: 'openid email profile',
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      hd: 'towncore.net',
    });
    expect(url.searchParams.get('code_challenge')).not.toBe(attempt.verifier);
  });
});

describe('verifyIdTokenClaims', () => {
  it('accepts a verified Workspace account on the company domain', () => {
    expect(verifyIdTokenClaims(idToken(), expected)).toEqual({
      email: 'pat@towncore.net',
      name: 'Pat Doe',
    });
    expect(
      verifyIdTokenClaims(idToken({ iss: 'accounts.google.com', aud: ['client-1'] }), expected),
    ).toMatchObject({ email: 'pat@towncore.net' });
  });

  it.each([
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['wrong audience', { aud: 'other-client' }],
    ['expired', { exp: NOW.getTime() / 1000 - 1 }],
    ['nonce mismatch', { nonce: 'replayed' }],
    ['email not verified', { email_verified: false }],
    ['wrong domain', { hd: undefined, email: 'pat@gmail.com' }],
    ['wrong domain', { hd: 'other.com' }],
    ['wrong domain', { email: 'pat@evil-towncore.net' }],
  ])('rejects: %s', (reason, overrides) => {
    expect(() => verifyIdTokenClaims(idToken(overrides), expected)).toThrow(
      new GoogleSignInError(reason),
    );
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyIdTokenClaims('garbage', expected)).toThrow(GoogleSignInError);
    expect(() => verifyIdTokenClaims('a.!!!.c', expected)).toThrow(GoogleSignInError);
  });
});

describe('exchangeCode', () => {
  const config = { clientId: 'client-1', clientSecret: 'secret' };

  it('posts the code and PKCE verifier and returns the ID token', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id_token: 'tok', access_token: 'x' }));
    await expect(exchangeCode(config, 'https://a/cb', 'code-1', 'ver', fetchImpl)).resolves.toBe(
      'tok',
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      code: 'code-1',
      client_id: 'client-1',
      client_secret: 'secret',
      redirect_uri: 'https://a/cb',
      grant_type: 'authorization_code',
      code_verifier: 'ver',
    });
  });

  it('fails on an error response or a missing ID token', async () => {
    const denied = vi.fn(async () => new Response('{}', { status: 400 }));
    await expect(exchangeCode(config, 'r', 'c', 'v', denied)).rejects.toThrow(GoogleSignInError);
    const empty = vi.fn(async () => Response.json({}));
    await expect(exchangeCode(config, 'r', 'c', 'v', empty)).rejects.toThrow('no id_token');
  });
});
