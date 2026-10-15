import { createHash, randomBytes } from 'node:crypto';
import { publisher, type Env } from '@towncore/config';

// Staff sign-in with Google (D-MAIL-2): OpenID Connect authorization-code flow with PKCE,
// limited to the company Workspace domain (publisher.hqDomain) plus the staff allow-list. Email-link
// sign-in works only while Google isn't configured, i.e. in local development and CI.

export type SignInMode =
  | { kind: 'google'; clientId: string; clientSecret: string; hqDomain: string }
  | { kind: 'email' }
  | { kind: 'misconfigured'; missing: string[] };

export function signInMode(env: Env, hqDomain: string = publisher.hqDomain): SignInMode {
  const parts = {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  };
  const missing = Object.entries(parts)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  // Setting any Google variable turns email links off, so a half-done setup fails closed.
  if (missing.length === 2) return { kind: 'email' };
  if (missing.length > 0) return { kind: 'misconfigured', missing };
  return {
    kind: 'google',
    clientId: parts.GOOGLE_CLIENT_ID!,
    clientSecret: parts.GOOGLE_CLIENT_SECRET!,
    hqDomain,
  };
}

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** One sign-in attempt's secrets, kept in a short-lived httpOnly cookie until the callback. */
export type OAuthAttempt = { state: string; nonce: string; verifier: string };

export function newAttempt(): OAuthAttempt {
  const random = () => randomBytes(32).toString('base64url');
  return { state: random(), nonce: random(), verifier: random() };
}

export function encodeAttempt(attempt: OAuthAttempt): string {
  return Buffer.from(JSON.stringify(attempt)).toString('base64url');
}

export function decodeAttempt(value: string | undefined): OAuthAttempt | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as OAuthAttempt;
    const ok = [parsed.state, parsed.nonce, parsed.verifier].every(
      (v) => typeof v === 'string' && v.length >= 32,
    );
    return ok ? parsed : null;
  } catch {
    return null;
  }
}

export function authorizationUrl(
  config: { clientId: string; hqDomain: string },
  redirectUri: string,
  attempt: OAuthAttempt,
): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    // A hint for Google's account picker only; the hd claim is checked after sign-in.
    hd: config.hqDomain,
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export class GoogleSignInError extends Error {}

/** Trades the authorization code for tokens at Google's token endpoint; returns the ID token. */
export async function exchangeCode(
  config: { clientId: string; clientSecret: string },
  redirectUri: string,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new GoogleSignInError(`token endpoint returned ${response.status}`);
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new GoogleSignInError('no id_token');
  return body.id_token;
}

/**
 * Checks the ID token's claims. The token comes straight from Google's token endpoint over
 * TLS, so OpenID Connect Core §3.1.3.7 lets us rely on TLS instead of the JWT signature; every
 * claim that decides who may sign in is still checked here.
 */
export function verifyIdTokenClaims(
  idToken: string,
  expected: { clientId: string; hqDomain: string; nonce: string; now?: Date },
): { email: string; name: string | null } {
  const payload = idToken.split('.')[1];
  if (!payload) throw new GoogleSignInError('malformed id_token');
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new GoogleSignInError('malformed id_token');
  }
  const nowSeconds = Math.floor((expected.now ?? new Date()).getTime() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const hq = expected.hqDomain.toLowerCase();
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';

  if (!GOOGLE_ISSUERS.has(String(claims.iss))) throw new GoogleSignInError('wrong issuer');
  if (!aud.includes(expected.clientId)) throw new GoogleSignInError('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds)
    throw new GoogleSignInError('expired');
  if (claims.nonce !== expected.nonce) throw new GoogleSignInError('nonce mismatch');
  if (claims.email_verified !== true) throw new GoogleSignInError('email not verified');
  // hd is set only for Workspace accounts, so a personal Gmail can't pass this.
  if (String(claims.hd ?? '').toLowerCase() !== hq) throw new GoogleSignInError('wrong domain');
  if (!email.endsWith(`@${hq}`)) throw new GoogleSignInError('wrong domain');
  return { email, name: typeof claims.name === 'string' ? claims.name : null };
}
