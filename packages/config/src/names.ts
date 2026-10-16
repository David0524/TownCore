// State files are all caps ("BAGEL CITY SOUTH", "ERGLE, GERALD K"). Names read better in title
// case, keeping legal suffixes and initialisms as they are. Shared by the directory and the
// roundups built from state records.

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
  // Street directions in addresses.
  'NE',
  'NW',
  'SE',
  'SW',
]);
const KEEP_LOWER = new Set(['and', 'of', 'the', 'at', 'by', 'for', 'in', 'on', 'a', 'an', '&']);
export function titleCase(value: string): string {
  const words = value.trim().replace(/\s+/g, ' ').split(' ');
  return words
    .map((word, i) => {
      const upper = word.toUpperCase();
      // Unit and suite numbers stay as written ("#K104B", "1048A").
      if (/^#[A-Z0-9-]+$|^\d+[A-Z]$/i.test(word)) return upper;
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
