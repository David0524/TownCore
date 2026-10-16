import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '@towncore/config';
import { clientUrl, createDb } from '../src/client';

// Neon connection strings carry `channel_binding=require`, which postgres.js would send to the
// server as a setting the server rejects (every query fails). The demo deploy hit this.
describe('clientUrl', () => {
  it('drops channel_binding and keeps everything else', () => {
    expect(
      clientUrl(
        'postgresql://user:p%40ss@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      ),
    ).toBe('postgresql://user:p%40ss@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require');
    const plain = 'postgres://towncore:towncore@localhost:5432/towncore';
    expect(clientUrl(plain)).toBe(plain);
  });

  const url = loadEnv().DATABASE_URL;
  const db = url ? createDb(`${url}${url.includes('?') ? '&' : '?'}channel_binding=require`) : null;
  afterAll(async () => db?.$client.end());

  it.skipIf(!db)('connects with a Neon-style URL', async () => {
    const [row] = await db!.$client`select 1 as one`;
    expect(row).toEqual({ one: 1 });
  });
});
