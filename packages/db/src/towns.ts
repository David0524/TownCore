import { findTbdFields, type LoadedTown, type TownSourceConfig } from '@towncore/config';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { sources, towns } from './schema';

export type SyncTownsResult = { upserted: string[]; sources: number; skippedSources: number };

/**
 * Upserts town YAML configs and themes into `towns`, keyed by slug. Files own config and theme;
 * the database owns status and readiness_score, which this never touches.
 * Sources are synced from config once adapters exist (M2).
 */
export async function syncTowns(db: Db, loaded: LoadedTown[]): Promise<SyncTownsResult> {
  const upserted: string[] = [];
  let sourceCount = 0;
  let skippedSources = 0;
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
      const [town] = await tx
        .insert(towns)
        .values(values)
        .onConflictDoUpdate({ target: towns.slug, set: { ...updates, updatedAt: sql`now()` } })
        .returning({ id: towns.id });
      upserted.push(config.slug);

      for (const source of config.sources) {
        // Sources with TBD fields aren't verified yet; they are never ingested (CLAUDE.md §14).
        if (findTbdFields(source).length > 0) {
          skippedSources++;
          continue;
        }
        const row = {
          townId: town!.id,
          key: sourceKey(source),
          kind: source.kind,
          platform: source.platform,
          adapter: source.platform,
          url: source.url ?? null,
          schedule: source.schedule ?? null,
          // Adapters get the town's timezone so local dates and times parse correctly.
          config: {
            timezone: config.timezone,
            ...(source.zone ? { zone: source.zone } : {}),
            ...(source.point ? { point: source.point } : {}),
            ...(source.beach ?? {}),
            ...(source.options ?? {}),
          },
        };
        await tx
          .insert(sources)
          .values(row)
          .onConflictDoUpdate({
            target: [sources.townId, sources.key],
            set: {
              platform: row.platform,
              adapter: row.adapter,
              url: row.url,
              schedule: row.schedule,
              config: row.config,
              updatedAt: sql`now()`,
            },
          });
        sourceCount++;
      }

      // Evergreen guides (M4 PR F): one reference source per topic, so each guide has its own
      // health and "last checked" date. Keyed by topic, so editing its pages updates it in place.
      for (const guide of config.guides) {
        const row = {
          townId: town!.id,
          key: guideSourceKey(guide.topic),
          kind: 'reference' as const,
          platform: 'page',
          adapter: 'page',
          url: guide.pages[0]!,
          schedule: null,
          config: { timezone: config.timezone, topic: guide.topic, pages: guide.pages },
        };
        await tx
          .insert(sources)
          .values(row)
          .onConflictDoUpdate({
            target: [sources.townId, sources.key],
            set: { url: row.url, config: row.config, updatedAt: sql`now()` },
          });
        sourceCount++;
      }
    }
  });
  return { upserted, sources: sourceCount, skippedSources };
}

/** Stable identity of a guide topic's reference source within its town. */
export const guideSourceKey = (topic: string) => `reference:page:guide:${topic}`;

/** Stable identity of a YAML source within its town. */
export function sourceKey(source: TownSourceConfig): string {
  const option = source.options ? `:${JSON.stringify(source.options)}` : '';
  return `${source.kind}:${source.platform}:${source.url ?? source.zone ?? ''}${option}`;
}
