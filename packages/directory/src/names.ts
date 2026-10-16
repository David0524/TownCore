// State files are all caps; titleCase lives in @towncore/config (shared with the roundups).
import { titleCase } from '@towncore/config';

export { titleCase };

const COMPANY =
  /\b(INC|LLC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PA|PLLC|GROUP|SERVICES?|ENTERPRISES?|HOLDINGS|PARTNERS)\b\.?/i;

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
