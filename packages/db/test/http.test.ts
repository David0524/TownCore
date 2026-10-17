import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createHttpDb, fromText, toParam, type SqlTransport } from '../src/http';
import { articles, images, staff, towns } from '../src/schema';
import { createTestDb } from '../src/testing';

// The demo's database over HTTP (packages/db/src/http.ts): the same Drizzle queries work when
// every value comes back as Postgres text, as Neon's SQL endpoint sends it. Here the "endpoint"
// is a local database read in raw text mode.

describe('database over HTTP', () => {
  let url: string;
  let drop: () => Promise<void>;
  let sql: postgres.Sql;
  let transport: SqlTransport;

  beforeAll(async () => {
    ({ url, drop } = await createTestDb());
    sql = postgres(url, { max: 1, onnotice: () => {} });
    transport = async (query, params, arrayMode) => {
      // Parameters arrive as untyped text, as at Neon's endpoint (postgres.js would serialize a
      // text "true" for a boolean column as false), so they're inlined as quoted literals.
      const text = query.replace(/\$(\d+)/g, (_, n: string) => {
        const p = params[Number(n) - 1];
        return p === null || p === undefined ? 'NULL' : `'${p.replace(/'/g, "''")}'`;
      });
      const result = await sql.unsafe(text).raw();
      const columns = result.columns ?? [];
      const rows = result.map((row) => {
        const values = (row as unknown as Array<Buffer | null>).map((v) =>
          v === null ? null : v.toString('utf8'),
        );
        return arrayMode ? values : Object.fromEntries(columns.map((c, i) => [c.name, values[i]]));
      });
      return { rows, fields: columns.map((c) => ({ dataTypeID: c.type })) };
    };
  });
  afterAll(async () => {
    await sql.end();
    await drop();
  });

  it('writes and reads rows with dates, JSON, arrays and booleans', async () => {
    const db = createHttpDb(transport);
    const [town] = await db
      .insert(towns)
      .values({
        slug: 'http-town',
        name: 'Http Town',
        state: 'ME',
        county: 'C',
        timezone: 'America/New_York',
        domain: 'http.test',
        siteName: 'Http Daily',
        tier: 'small',
        config: { guides: [] },
      })
      .returning();
    expect(town!.config).toEqual({ guides: [] });
    expect(town!.createdAt).toBeInstanceOf(Date);
    await db.insert(staff).values({ email: 'a@towncore.net', name: 'A', role: 'admin' });
    const [person] = await db
      .select({ id: staff.id, active: staff.active })
      .from(staff)
      .where(and(eq(staff.email, 'a@towncore.net'), eq(staff.active, true)));
    expect(person!.active).toBe(true);
    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
    const [article] = await db
      .insert(articles)
      .values({
        townId: town!.id,
        slug: 's',
        headline: 'H "quoted"',
        bodyMd: 'B',
        beat: 'government',
        tier: 1,
        status: 'published',
        byline: 'Http Daily Newsroom',
        sourceRecordIds: ids,
        publishedAt: new Date('2026-10-17T12:00:00Z'),
      })
      .returning();
    expect(article!.sourceRecordIds).toEqual(ids);
    expect(article!.publishedAt).toEqual(new Date('2026-10-17T12:00:00Z'));
    const values = {
      articleId: article!.id,
      kind: 'ai-illustration' as const,
      spec: { type: 'illustration' as const, illustrationId: 'gov-01', width: 1, height: 1 },
      alt: 'A dais.',
      license: 'own-work',
      aiGenerated: true,
      approvedBy: person!.id,
      coverIllustrationId: null,
    };
    await db
      .insert(images)
      .values(values)
      .onConflictDoUpdate({ target: images.articleId, set: values });
    const [image] = await db.select().from(images).where(eq(images.articleId, article!.id));
    expect(image).toMatchObject({
      spec: values.spec,
      aiGenerated: true,
      coverIllustrationId: null,
    });
  });

  it('sends parameters as text', () => {
    expect(toParam(['a', 'b"c', null])).toBe('{"a","b\\"c",NULL}');
    expect(toParam(new Date('2026-10-17T00:00:00Z'))).toBe('2026-10-17T00:00:00.000Z');
    expect(toParam({ a: 1 })).toBe('{"a":1}');
    expect(toParam(true)).toBe('true');
    expect(fromText('f', 16)).toBe(false);
    expect(fromText('{t,f}', 1000)).toEqual([true, false]);
  });
});
