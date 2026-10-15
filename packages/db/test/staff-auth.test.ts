import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client';
import { eq } from 'drizzle-orm';
import { staff, staffLoginTokens } from '../src/schema';
import {
  createLoginToken,
  endSession,
  findOrCreateStaff,
  getSessionStaff,
  hashToken,
  LOGIN_LINKS_PER_HOUR,
  redeemLoginToken,
  TooManyLoginLinks,
} from '../src/staff-auth';
import { createTestDb } from '../src/testing';

let db: Db;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ db, drop } = await createTestDb());
});
afterAll(async () => drop());

const NOW = new Date('2026-10-15T12:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('staff sign-in', () => {
  it('creates staff only for ADMIN_EMAILS, as the placeholder reviewer', async () => {
    expect(await findOrCreateStaff(db, 'stranger@example.com', ['editor@example.com'])).toBeNull();
    const member = await findOrCreateStaff(db, ' Editor@Example.com ', ['editor@example.com']);
    expect(member).toMatchObject({
      email: 'editor@example.com',
      name: 'John',
      role: 'admin',
      placeholder: true,
    });
    // Idempotent.
    const again = await findOrCreateStaff(db, 'editor@example.com', ['editor@example.com']);
    expect(again?.id).toBe(member?.id);
  });

  it('a link works once, within 15 minutes, and stores only a hash', async () => {
    const member = (await findOrCreateStaff(db, 'a@example.com', ['a@example.com']))!;
    const token = await createLoginToken(db, member.id, NOW);
    const rows = await db.select().from(staffLoginTokens);
    expect(rows.map((r) => r.tokenHash)).toContain(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);

    expect(await redeemLoginToken(db, 'wrong', NOW)).toBeNull();
    const session = await redeemLoginToken(db, token, later(60_000));
    expect(session?.staff.id).toBe(member.id);
    expect(await redeemLoginToken(db, token, later(60_000))).toBeNull(); // used

    const stale = await createLoginToken(db, member.id, NOW);
    expect(await redeemLoginToken(db, stale, later(16 * 60_000))).toBeNull(); // expired

    expect((await getSessionStaff(db, session!.sessionToken, later(86_400_000)))?.id).toBe(
      member.id,
    );
    expect(await getSessionStaff(db, session!.sessionToken, later(31 * 86_400_000))).toBeNull();
    await endSession(db, session!.sessionToken);
    expect(await getSessionStaff(db, session!.sessionToken, NOW)).toBeNull();
  });

  it('allows at most 5 links an hour per person', async () => {
    const member = (await findOrCreateStaff(db, 'b@example.com', ['b@example.com']))!;
    for (let i = 0; i < LOGIN_LINKS_PER_HOUR; i++) await createLoginToken(db, member.id, NOW);
    await expect(createLoginToken(db, member.id, later(60_000))).rejects.toBeInstanceOf(
      TooManyLoginLinks,
    );
    await expect(createLoginToken(db, member.id, later(3_700_000))).resolves.toBeTypeOf('string');
  });

  it('deactivated staff cannot sign in, and their sessions stop working', async () => {
    const member = (await findOrCreateStaff(db, 'c@example.com', ['c@example.com']))!;
    const session = await redeemLoginToken(db, await createLoginToken(db, member.id, NOW), NOW);
    const pending = await createLoginToken(db, member.id, NOW);
    await db.update(staff).set({ active: false }).where(eq(staff.id, member.id));

    expect(await getSessionStaff(db, session!.sessionToken, NOW)).toBeNull();
    expect(await redeemLoginToken(db, pending, NOW)).toBeNull();
    expect(await findOrCreateStaff(db, 'c@example.com', ['c@example.com'])).toBeNull();
  });
});
