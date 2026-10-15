import type { LoadedTown } from '@towncore/config';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { towns } from './schema';

export type SyncTownsResult = { upserted: string[] };

/**
 * Upserts town YAML configs and themes into `towns`, keyed by slug. Files own config and theme;
 * the database owns status and readiness_score, which this never touches.
 * Sources are synced from config once adapters exist (M2).
 */
export async function syncTowns(db: Db, loaded: LoadedTown[]): Promise<SyncTownsResult> {
  const upserted: string[] = [];
  await db.transaction(async (tx) => {
    for (const { config, theme, hasThemeFile } of loaded) {
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
        theme: hasThemeFile ? theme : null,
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
