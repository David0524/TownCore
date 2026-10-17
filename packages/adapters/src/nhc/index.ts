import type { TropicalArea, TropicalStorm, TropicsBasin, TropicsSnapshot } from '@towncore/config';
import type { Fetcher } from '../http/fetcher';

// National Hurricane Center (tropics panel, packages/config/src/tropics.ts): active storms and the
// Tropical Weather Outlook for every basin, read once an hour for the whole network. Two requests a
// run, whatever the number of towns. www.nhc.noaa.gov/robots.txt is `Disallow:` (empty), checked
// 2026-10-17; NHC's RSS page asks feed readers to check "once an hour or so". NWS products are in
// the public domain (https://www.weather.gov/disclaimer); we credit NHC and link its pages.

const STORMS = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const OUTLOOKS = 'https://www.nhc.noaa.gov/gtwo.xml';

/** NHC's bin prefixes and outlook titles per basin. */
const BASINS: Record<TropicsBasin, { bin: string; outlook: string }> = {
  atlantic: { bin: 'AT', outlook: 'Atlantic Tropical Weather Outlook' },
  'east-pacific': { bin: 'EP', outlook: 'Eastern Pacific Tropical Weather Outlook' },
  'central-pacific': { bin: 'CP', outlook: 'Central Pacific Tropical Weather Outlook' },
};

type StormRow = {
  id?: string;
  binNumber?: string;
  name?: string;
  classification?: string;
  intensity?: string;
  pressure?: string;
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number;
  movementSpeed?: number;
  publicAdvisory?: { advNum?: string; issuance?: string; url?: string } | null;
  forecastGraphics?: { url?: string } | null;
};

const num = (s: string | undefined) => (s && /^\d+$/.test(s.trim()) ? Number(s) : null);

export function stormFromRow(row: StormRow): { basin: TropicsBasin; storm: TropicalStorm } | null {
  const bin = row.binNumber?.slice(0, 2);
  const basin = (Object.keys(BASINS) as TropicsBasin[]).find((b) => BASINS[b].bin === bin);
  if (!basin || !row.id || !row.name || row.latitudeNumeric === undefined) return null;
  const adv = row.publicAdvisory;
  return {
    basin,
    storm: {
      id: row.id,
      name: row.name,
      classification: row.classification ?? 'TC',
      windKt: num(row.intensity),
      pressureMb: num(row.pressure),
      latitude: row.latitudeNumeric,
      longitude: row.longitudeNumeric ?? 0,
      // NHC gives the heading in degrees and the speed in miles per hour, as its advisories do.
      movement:
        typeof row.movementDir === 'number' && typeof row.movementSpeed === 'number'
          ? { direction: row.movementDir, mph: row.movementSpeed }
          : null,
      advisory:
        adv?.advNum && adv.issuance && adv.url
          ? { number: adv.advNum.replace(/^0+(?=\d)/, ''), issuedAt: adv.issuance, url: adv.url }
          : null,
      graphicsUrl: row.forecastGraphics?.url ?? null,
    },
  };
}

/**
 * The outlook as paragraphs, without NHC's product header and forecaster signature: from "For
 * the …" up to the `$$` line. Lines inside a paragraph are joined; the "* Formation chance" bullets
 * keep their own lines.
 */
export function outlookParagraphs(html: string): string[] {
  const paragraphs = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .reduce(
          (out, line) =>
            line.startsWith('*') || !out ? `${out}${out ? '\n' : ''}${line}` : `${out} ${line}`,
          '',
        ),
    )
    .filter(Boolean);
  const start = paragraphs.findIndex((p) => p.startsWith('For the '));
  const end = paragraphs.findIndex((p) => p.startsWith('$$'));
  return paragraphs.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
}

const percent = (paragraph: string, window: string) => {
  const m = paragraph.match(
    new RegExp(`Formation chance through ${window}\\.+\\w+\\.+(?:near )?(\\d+) percent`, 'i'),
  );
  return m ? Number(m[1]) : null;
};

/**
 * The disturbances NHC is watching, with formation chances. An area is a paragraph whose first
 * words name it ("1. Central Tropical Atlantic (AL94):", "South of Southern Mexico:").
 */
export function outlookAreas(paragraphs: string[]): TropicalArea[] {
  return paragraphs.flatMap((p) => {
    if (!/Formation chance through/i.test(p)) return [];
    const name = p.match(/^(?:\d+\.\s*)?([^:]{3,80}):/)?.[1]?.trim();
    if (!name) return [];
    return [{ title: name, twoDay: percent(p, '48 hours'), sevenDay: percent(p, '7 days') }];
  });
}

type OutlookItem = { title: string; html: string; issuedAt: string; url: string };

function outlookItems(xml: string): OutlookItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const tag = (name: string) => item!.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
    const title = tag('title')?.trim();
    const html = tag('description')?.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
    const pubDate = tag('pubDate');
    if (!title || !html || !pubDate) return [];
    const issued = new Date(pubDate.replace(' UTC', ' GMT'));
    if (Number.isNaN(issued.getTime())) return [];
    return [
      {
        title,
        html,
        issuedAt: issued.toISOString(),
        url: (tag('link') ?? 'https://www.nhc.noaa.gov/').replace(/&amp;/g, '&').trim(),
      },
    ];
  });
}

/** Every basin's snapshot from NHC's two shared files. */
export async function fetchTropics(fetcher: Fetcher): Promise<TropicsSnapshot[]> {
  const storms = await fetcher.getJson<{ activeStorms?: StormRow[] }>(STORMS);
  const xml = await fetcher.getText(OUTLOOKS, { accept: 'application/rss+xml' });
  return parseTropics(storms.activeStorms ?? [], xml);
}

export function parseTropics(rows: StormRow[], xml: string): TropicsSnapshot[] {
  const storms = rows.flatMap((r) => stormFromRow(r) ?? []);
  const items = outlookItems(xml);
  return (Object.keys(BASINS) as TropicsBasin[]).map((basin) => {
    const item = items.find((i) => i.title === BASINS[basin].outlook);
    const paragraphs = item ? outlookParagraphs(item.html) : [];
    return {
      basin,
      storms: storms.filter((s) => s.basin === basin).map((s) => s.storm),
      outlook: item
        ? {
            issuedAt: item.issuedAt,
            text: paragraphs.join('\n\n'),
            areas: outlookAreas(paragraphs),
            url: item.url,
          }
        : null,
    };
  });
}
