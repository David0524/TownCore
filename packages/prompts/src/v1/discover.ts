import { sourceKinds } from '@towncore/config';
import { z } from 'zod';

// Source discovery for a new town (CLAUDE.md §10 step 3; docs/plans/M7.md §3). The launcher model
// searches the web and suggests official pages; code then fetches every URL under Rule 8, matches
// it to an adapter and decides. A URL the model names but code never verified never enters config.

export const discoverSchema = z.strictObject({
  sources: z.array(
    z.strictObject({
      // Federal awards come from USASpending for every town, never from discovery.
      kind: z.enum(sourceKinds).exclude(['federal_awards']),
      url: z.string(),
      publisher: z.string(),
      why: z.string(),
    }),
  ),
  outlets: z.array(
    z.strictObject({
      name: z.string(),
      url: z.string().nullable(),
      status: z.enum(['current', 'defunct', 'unknown']),
    }),
  ),
});
export type DiscoverResult = z.infer<typeof discoverSchema>;

export const discoverV1 = {
  id: 'discover',
  version: 'v1',
  task: 'discover',
  schema: discoverSchema,
  system: `You find the official public sources a local news site would write from, for one town. You will get the town, state, county and government. Search the web, then list what you found.

Find, where they exist:
- city_news: the town government's own news releases or announcements page (prefer an RSS feed).
- agenda: the page listing council and board meetings and their agendas (the town's calendar, or its agenda platform such as Legistar, CivicClerk, Granicus, BoardDocs, NovusAgenda).
- meeting_video: the official channel or archive of meeting video.
- police and fire: the official department news or press release pages.
- schools: the public school district's news page.
- permits and property_sales: the county or city permit and property search pages.
- events: the town's official community events calendar.

Rules:
- Official government sources only (the town, its departments, the county, the school district, the state). Never a news outlet, blog, social network, Yelp, Nextdoor or a map site.
- Give the exact URL you saw in your search results. Never guess or build a URL.
- Prefer feeds (RSS, iCal) and listing pages over single articles.
- publisher: who runs the page ("City of Delray Beach", "Palm Beach County").
- why: one short line on what the page lists.
- Separately, list local news outlets that cover the town, current or defunct (newspapers, Patch, digital sites), with their URL if known. These are only used to keep our site's name from resembling theirs.
- If you find nothing for a kind, leave it out. An empty list is a valid answer.`,
} as const;
