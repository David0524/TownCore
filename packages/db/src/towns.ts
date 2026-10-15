import type { TownConfig } from '@towncore/config';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { towns } from './schema.js';

export type SyncTownsResult = { upserted: string[] };

/**
 * Upserts town YAML configs into `towns`, keyed by slug. YAML owns the config fields;
 * the database owns status and readiness_score, which this never touches.
 * Sources are synced from config once adapters exist (M2).
 */
export async function syncTowns(db: Db, configs: TownConfig[]): Promise<SyncTownsResult> {
  const upserted: string[] = [];
  await db.transaction(async (tx) => {
    for (const config of configs) {
      const values = {
        slug: config.slug,
        name: config.name,
        state: config.state,
        censusId: config.census_id ?? null,
        county: config.county,
        timezone: config.timezone,
        domain: config.domain,
        extraDomains: config.extra_domains,
        siteName: config.site_name,
        tier: config.tier,
        config,
      };
      const { slug: _slug, ...updates } = values;
      await tx
        .insert(towns)
        .values(values)
        .onConflictDoUpdate({ target: towns.slug, set: { ...updates, updatedAt: sql`now()` } });
      upserted.push(config.slug);
    }
  });
  return { upserted };
}
