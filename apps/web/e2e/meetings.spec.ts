import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  and,
  createDb,
  eq,
  getTownBySlug,
  records,
  sources,
  staff,
  staffSessions,
} from '@towncore/db';

// Meeting captions (Admin → Meetings): staff add a caption file the town published for a past
// meeting; it becomes the meeting's transcript, ready for its recap.

// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const admin = 'http://admin.test';

async function staffPage(browser: Browser) {
  const [member] = await db
    .insert(staff)
    .values({ email: `meetings-${Date.now()}@towncore.net`, name: 'Clerk', role: 'reviewer' })
    .returning();
  const token = randomBytes(24).toString('base64url');
  await db.insert(staffSessions).values({
    staffId: member!.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'tc_admin', value: token, url: `${admin}/admin` }]);
  return { context, page: await context.newPage() };
}

const CAPTIONS = [
  'WEBVTT',
  '',
  ...Array.from({ length: 12 }, (_, i) => [
    `00:${String(i).padStart(2, '0')}:00.000 --> 00:${String(i).padStart(2, '0')}:20.000`,
    `<v Clerk>Item ${i + 1}: the commission discussed the harbor dredging plan in detail.</v>`,
    '',
  ]).flat(),
].join('\n');

test('staff add a meeting’s captions; it becomes the meeting’s transcript', async ({
  browser,
}, info) => {
  const town = (await getTownBySlug(db, 'harbor-point'))!;
  const key = `e2e-meetings-${info.project.name}`;
  await db
    .insert(sources)
    .values({ townId: town.id, kind: 'agenda', platform: 'test', adapter: 'test', key })
    .onConflictDoNothing();
  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.townId, town.id), eq(sources.key, key)));
  const title = `Harbor Commission ${info.project.name} ${Date.now() % 100000}`;
  const meetingId = randomBytes(6).toString('hex');
  await db.insert(records).values({
    sourceId: source!.id,
    townId: town.id,
    externalId: `event:${meetingId}`,
    type: 'meeting',
    title,
    text: 'When: Monday, 7:00 PM\nBody: Harbor Commission',
    occurredAt: new Date(Date.now() - 86_400_000),
    contentHash: meetingId,
  });

  const { context, page } = await staffPage(browser);
  await page.goto(`${admin}/admin/meetings`);
  await expect(page.getByRole('link', { name: 'Meetings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const row = page.getByTestId('meeting-row').filter({ hasText: title });
  await expect(row).toContainText('Harbor Point');
  await expect(row).toContainText('none yet');
  await row.getByLabel('Caption file (.vtt, .srt or .txt)').setInputFiles({
    name: 'commission.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(CAPTIONS),
  });
  await row.getByRole('checkbox').check();
  await row.getByRole('button', { name: 'Add captions' }).click();
  await expect(page.getByRole('status')).toContainText('Captions added');
  await expect(page.getByRole('status')).toContainText('12 timed captions');
  await expect(page.getByTestId('meeting-row').filter({ hasText: title })).toContainText(
    'uploaded',
  );
  await context.close();

  const [transcript] = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.sourceId, source!.id),
        eq(records.externalId, `transcript-upload:${meetingId}`),
      ),
    );
  expect(transcript!.type).toBe('transcript');
  expect(transcript!.text).toContain('Item 1: the commission discussed the harbor dredging plan');
});
