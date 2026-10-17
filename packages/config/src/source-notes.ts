// How a story's sources are named in its Sources box, and the one-sentence "About this data" note
// each kind of record gets (owner, 2026-10-17: "sources that don't swamp the page"). One list for
// every town: a roundup built from 101 state filings shows one line, "Florida Division of
// Corporations, daily filings, Oct. 5–11 (101 records)", with its note, instead of 101 links.
// The notes carry the caveats roundups used to repeat in their text, built once here.
//
// Lookup order: "<platform>:<record type>", then "<record type>". State platforms (fl-*) name
// their agency; local open-data platforms name the dataset, and the publisher comes from the
// source's host.

export type SourceDescription = {
  /** The publisher, when the platform says who it is. */
  publisher?: string;
  /** What the records are, in a few words ("daily filings"). */
  dataset: string;
  /** "About this data": one sentence on what the records are and their limits. */
  about?: string;
};

const OUTSIDE = 'The address is a mailing address, which can be outside city limits.';

const DESCRIPTIONS: Record<string, SourceDescription> = {
  'fl-sunbiz:new-filing': {
    publisher: 'Florida Division of Corporations',
    dataset: 'daily filings',
    about: `New company registrations with the state. A filing isn't an opening, and the kind of business is read from its name. ${OUTSIDE}`,
  },
  'fl-dbpr:license': {
    publisher: 'Florida Department of Business and Professional Regulation',
    dataset: 'license files',
    about: `First state licenses for contractors. ${OUTSIDE} Check a license with the state before you hire.`,
  },
  'fl-dbpr:new_food_license': {
    publisher: 'Florida Division of Hotels and Restaurants',
    dataset: 'new food service licenses',
    about: `State approval to serve food, which comes before opening day. ${OUTSIDE}`,
  },
  'fl-dbpr:food_license': {
    publisher: 'Florida Division of Hotels and Restaurants',
    dataset: 'food service licenses',
    about: `Active food service licenses. ${OUTSIDE}`,
  },
  'fl-dbpr:liquor_license': {
    publisher: 'Florida Division of Alcoholic Beverages and Tobacco',
    dataset: 'daily license activity',
    about: `New licenses to sell beer, wine or liquor, which come before opening day. ${OUTSIDE}`,
  },
  'fl-dbpr:inspection': {
    publisher: 'Florida Division of Hotels and Restaurants',
    dataset: 'food service inspections',
    about: `Each inspection is a snapshot of one visit. ${OUTSIDE}`,
  },
  'new-filing': {
    dataset: 'new business filings',
    about: `New company registrations with the state. A filing isn't an opening, and the kind of business is read from its name. ${OUTSIDE}`,
  },
  sale: {
    dataset: 'property sales',
    about:
      "Sales from county property records. Deeds take about two weeks to record, so late sales may be missing; owners' and buyers' names are never collected.",
  },
  permit: {
    dataset: 'building permits',
    about: "Permits from the local government's open data. Costs are the applicants' estimates.",
  },
  'usaspending:federal-award': {
    publisher: 'USASpending.gov (U.S. Treasury)',
    dataset: 'federal awards',
    about:
      "New federal contracts and grants. The recipient's address is its mailing address, and the work can be done anywhere; amounts are what the government obligated, which can grow later. Defense contracts appear 90 days late.",
  },
  'cms:nursing-home-inspection': {
    publisher: 'Centers for Medicare & Medicaid Services',
    dataset: 'nursing home health inspections',
    about:
      "Federal health inspections as published on Medicare's Care Compare, two to six months after the visit. Each citation is rated A to L for scope and severity; J to L is immediate jeopardy. An inspection that found nothing isn't listed. The address is the home's mailing address, which can be outside city limits.",
  },
  'cms:nursing-home-penalty': {
    publisher: 'Centers for Medicare & Medicaid Services',
    dataset: 'nursing home penalties',
    about:
      'Fines and payment denials Medicare imposed, posted months later. A home may appeal; amounts are as CMS lists them.',
  },
  'development-project': {
    dataset: 'development projects map',
    about:
      "Projects on the local government's development map and the stage it lists each one in. The map has no dates: a project counts as moved the week the map first shows it at a new stage, which can be weeks after a vote or permit. Single homes are left out.",
  },
  'road-work': {
    dataset: 'road and bridge construction list',
    about: "The county's list of planned work. Dates and lane closures can change.",
  },
  meeting: {
    dataset: 'public meeting calendar',
    about: 'Meetings as listed on the government calendar. Agendas can change before a meeting.',
  },
  agenda: { dataset: 'meeting agendas' },
  minutes: { dataset: 'meeting minutes' },
  'meeting-actions': { dataset: 'recorded meeting actions' },
  'meeting-video': { dataset: 'meeting video' },
  transcript: {
    dataset: 'meeting transcript',
    about: 'Machine-made captions of the meeting video, which can misspell names.',
  },
  alert: {
    publisher: 'National Weather Service',
    dataset: 'alerts',
    about: 'Alerts as the National Weather Service issued them.',
  },
  forecast: { publisher: 'National Weather Service', dataset: 'forecast' },
  release: { dataset: 'news releases' },
  'release-link': { dataset: 'news releases' },
  page: { dataset: 'official page' },
  game: { dataset: 'scores' },
};

/** The description for a record type from a platform, or a plain fallback. */
export function describeSource(platform: string | null, type: string): SourceDescription {
  return (
    (platform ? DESCRIPTIONS[`${platform}:${type}`] : undefined) ??
    DESCRIPTIONS[type] ?? { dataset: type.replace(/[-_]/g, ' ') }
  );
}

/** "maps.co.palm-beach.fl.us" from a URL, without "www."; null when it isn't one. */
export function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
