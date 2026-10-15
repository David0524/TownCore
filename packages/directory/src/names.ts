// State files are all caps ("BAGEL CITY SOUTH", "ERGLE, GERALD K"). Listings read better in
// title case, keeping legal suffixes and initialisms as they are.

const KEEP_UPPER = new Set([
  'LLC',
  'INC',
  'LLP',
  'PLLC',
  'PA',
  'P.A.',
  'LP',
  'II',
  'III',
  'IV',
  'USA',
  'US',
  'AC',
  'A/C',
  'HVAC',
  'BBQ',
  'NY',
  'FL',
  'DBA',
]);
const KEEP_LOWER = new Set(['and', 'of', 'the', 'at', 'by', 'for', 'in', 'on', 'a', 'an', '&']);
const COMPANY =
  /\b(INC|LLC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PA|PLLC|GROUP|SERVICES?|ENTERPRISES?|HOLDINGS|PARTNERS)\b\.?/i;

export function titleCase(value: string): string {
  const words = value.trim().replace(/\s+/g, ' ').split(' ');
  return words
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper.replace(/[,.]$/, '')) || KEEP_UPPER.has(upper)) return upper;
      const lower = word.toLowerCase();
      if (i > 0 && KEEP_LOWER.has(lower)) return lower;
      // Capitalize each part of hyphenated words and after "Mc" ("MCDONALD" → "McDonald").
      return lower
        .replace(/(^|[-/(])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
        .replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`);
    })
    .join(' ');
}

/**
 * A licensee's name as readers know it. Individual licensees are filed "LAST, FIRST M"; a
 * company name with a comma ("SMITH, JONES & CO") stays in order.
 */
export function displayName(name: string): string {
  const trimmed = name.trim();
  const m = /^([A-Z'\- ]+), ([A-Z'\-. ]+)$/i.exec(trimmed);
  if (m && !COMPANY.test(trimmed)) return titleCase(`${m[2]} ${m[1]}`);
  return titleCase(trimmed);
}

/** URL slug: name plus license number, so it is unique and never changes with a rename. */
export function listingSlug(name: string, license: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${base || 'business'}-${license.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
