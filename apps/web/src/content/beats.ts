// What each beat covers and which kinds of public sources feed it (docs/plans/M4b.md §4, beat
// front). Shared by every town; the source list shown is only the sources a town really has.

export const beatCoverage: Record<string, { covers: string; kinds: string[] }> = {
  government: {
    covers: 'City meetings, votes, budgets and what the city announces.',
    kinds: ['agenda', 'meeting_video', 'city_news'],
  },
  development: {
    covers: 'Building permits, zoning, development projects and property.',
    kinds: ['permits', 'property_sales', 'agenda'],
  },
  business: {
    covers: 'New businesses, licenses, openings and closings.',
    kinds: ['business_filings', 'inspections'],
  },
  schools: {
    covers: 'School board decisions, schedules and district news.',
    kinds: ['schools'],
  },
  'public-safety': {
    covers: 'Official police and fire releases. We never publish mugshots or rumors.',
    kinds: ['police', 'fire'],
  },
  community: {
    covers: 'Events, weather alerts and community news.',
    kinds: ['events', 'weather', 'city_news'],
  },
};

/** A reader-facing name for one of our sources. */
export function sourceLabel(source: { kind: string; platform: string }): string {
  const byPlatform: Record<string, string> = {
    'fl-sunbiz': 'Florida Division of Corporations filings',
    'fl-dbpr': 'Florida DBPR license records',
    nws: 'National Weather Service',
  };
  const byKind: Record<string, string> = {
    agenda: "the city's public meeting calendar",
    meeting_video: 'city meeting video',
    city_news: 'city news releases',
    permits: 'building permit records',
    property_sales: 'property sale records',
    business_filings: 'state business records',
    inspections: 'inspection records',
    schools: 'school district notices',
    police: 'police department releases',
    fire: 'fire department releases',
    events: 'official event calendars',
    weather: 'National Weather Service',
  };
  return byPlatform[source.platform] ?? byKind[source.kind] ?? source.kind;
}
