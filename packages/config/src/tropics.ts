// The tropics panel (National Hurricane Center): one snapshot per basin, fetched once an hour
// for the whole network (packages/adapters/src/nhc) and shown on the Weather page, the Today tile
// and the newsletter of towns that basin's storms can reach. Display data only, never a story:
// the same storm would be the same story on every coastal site (near-duplicate guard), and the
// local watches and warnings that matter already come from each town's NWS alerts.

export const tropicsBasins = ['atlantic', 'east-pacific', 'central-pacific'] as const;
export type TropicsBasin = (typeof tropicsBasins)[number];

/** An active storm as NHC reports it, with its latest public advisory. */
export type TropicalStorm = {
  id: string;
  name: string;
  /** NHC's class code: TD, TS, HU, STD, STS, PTC, PC (post-tropical) or TC. */
  classification: string;
  /** Maximum sustained wind, knots. */
  windKt: number | null;
  pressureMb: number | null;
  latitude: number;
  longitude: number;
  /** Heading in degrees and speed in miles per hour, when NHC gives them. */
  movement: { direction: number; mph: number } | null;
  advisory: { number: string; issuedAt: string; url: string } | null;
  /** The storm's graphics page (cone, warnings). */
  graphicsUrl: string | null;
};

/** One disturbance in the Tropical Weather Outlook, with NHC's formation chances. */
export type TropicalArea = {
  title: string;
  /** Percent chance of formation in 48 hours and in 7 days, as NHC states them. */
  twoDay: number | null;
  sevenDay: number | null;
};

export type TropicsSnapshot = {
  basin: TropicsBasin;
  storms: TropicalStorm[];
  outlook: {
    issuedAt: string;
    /** The outlook as NHC wrote it, without its header and signature lines. */
    text: string;
    areas: TropicalArea[];
    url: string;
  } | null;
};

const ATLANTIC_STATES = new Set([
  'TX', 'LA', 'MS', 'AL', 'FL', 'GA', 'SC', 'NC', 'VA', 'DC', 'MD', 'DE', 'NJ', 'NY', 'CT', 'RI',
  'MA', 'NH', 'ME', 'PR', 'VI',
]); // prettier-ignore

/** The basin whose storms can reach a town in this state, or null (no tropics panel). */
export function tropicsBasin(state: string): TropicsBasin | null {
  const s = state.toUpperCase();
  if (ATLANTIC_STATES.has(s)) return 'atlantic';
  if (s === 'CA') return 'east-pacific';
  if (s === 'HI') return 'central-pacific';
  return null;
}

/** NHC's class codes in plain words. */
const CLASS_NAMES: Record<string, string> = {
  TD: 'Tropical Depression',
  STD: 'Subtropical Depression',
  TS: 'Tropical Storm',
  STS: 'Subtropical Storm',
  HU: 'Hurricane',
  MH: 'Major Hurricane',
  PTC: 'Potential Tropical Cyclone',
  PC: 'Post-Tropical Cyclone',
  TC: 'Tropical Cyclone',
};

/** "Hurricane Trudy", "Tropical Storm Ana", "Potential Tropical Cyclone Four". */
export function stormName(storm: TropicalStorm): string {
  const kind = CLASS_NAMES[storm.classification] ?? 'Tropical Cyclone';
  return `${kind} ${storm.name}`;
}

/** Wind in miles per hour, rounded to 5 like NHC's advisories. */
export function stormMph(storm: TropicalStorm): number | null {
  return storm.windKt === null ? null : Math.round((storm.windKt * 1.15078) / 5) * 5;
}

/** A disturbance worth a line on the Today tile and in the newsletter: 40% or more in 7 days. */
export const NOTABLE_FORMATION_PERCENT = 40;

/**
 * The one line the Today tile and newsletter show for a basin, or null when nothing is active
 * and no disturbance reaches NOTABLE_FORMATION_PERCENT. Storms first, strongest first.
 */
export function tropicsLine(snapshot: TropicsSnapshot): string | null {
  const storms = snapshot.storms
    .filter((s) => s.classification !== 'PC')
    .sort((a, b) => (b.windKt ?? 0) - (a.windKt ?? 0));
  if (storms.length) {
    const lead = storms[0]!;
    const mph = stormMph(lead);
    const more = storms.length > 1 ? `, and ${storms.length - 1} more active` : '';
    return `${stormName(lead)}${mph ? `, ${mph} mph winds` : ''}${more}`;
  }
  const area = (snapshot.outlook?.areas ?? [])
    .filter((a) => (a.sevenDay ?? 0) >= NOTABLE_FORMATION_PERCENT)
    .sort((a, b) => (b.sevenDay ?? 0) - (a.sevenDay ?? 0))[0];
  return area
    ? `Hurricane Center watching ${area.title}: ${area.sevenDay}% chance in 7 days`
    : null;
}
