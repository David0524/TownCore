import { publisherLine, townContactEmail, type TownConfig } from '@towncore/config';
import type { Town } from '@towncore/db';

/** Fills {placeholders} in shared page copy. One copy serves every town, so it can't drift. */
export function fillTemplate(template: string, town: Town): string {
  const vars: Record<string, string> = {
    site_name: town.siteName,
    town_name: town.name,
    state: town.state,
    publisher_line: publisherLine(town.siteName),
    contact_email: townContactEmail(town.config as TownConfig),
  };
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`Unknown placeholder ${match} in page copy`);
    return value;
  });
}
