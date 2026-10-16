// Entities (CLAUDE.md §6a; docs/plans/M4.md §4): the businesses, streets, neighborhoods, schools,
// public officials, projects and agencies our stories name, each with a topic page listing them.

export const entityKinds = [
  'business',
  'street',
  'neighborhood',
  'school',
  'official',
  'project',
  'agency',
] as const;
export type EntityKind = (typeof entityKinds)[number];

export const entityKindLabels: Record<EntityKind, string> = {
  business: 'Business',
  street: 'Street',
  neighborhood: 'Neighborhood',
  school: 'School',
  official: 'Public official',
  project: 'Project',
  agency: 'Agency',
};

/** A topic page is indexed only once it lists this many published stories (D-M4-5). */
export const TOPIC_INDEX_MIN_ARTICLES = 3;

const STREET_WORDS: Record<string, string> = {
  rd: 'road',
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  ln: 'lane',
  ct: 'court',
  pkwy: 'parkway',
  hwy: 'highway',
  pl: 'place',
  ter: 'terrace',
  cir: 'circle',
  trl: 'trail',
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  nw: 'northwest',
  ne: 'northeast',
  sw: 'southwest',
  se: 'southeast',
};

const BUSINESS_SUFFIXES = new Set([
  'llc',
  'inc',
  'corp',
  'corporation',
  'co',
  'ltd',
  'llp',
  'pa',
  'pllc',
]);

/**
 * The key two mentions must share to be one entity, within a town and kind. Conservative on
 * purpose (§4: when unsure, keep two entities rather than merge wrong ones): only case,
 * punctuation, a leading "the", street abbreviations and business-form suffixes are ignored.
 */
export function entityKey(kind: EntityKind, name: string): string {
  let words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words[0] === 'the') words = words.slice(1);
  if (kind === 'street') words = words.map((w) => STREET_WORDS[w] ?? w);
  if (kind === 'business') {
    while (words.length > 1 && BUSINESS_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  }
  return words.join(' ');
}
