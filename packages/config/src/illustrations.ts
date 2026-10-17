// Section illustrations (CLAUDE.md §11c; owner approved 2026-10-16): a network-wide library of
// AI-generated illustrations, made once from this shot list in ChatGPT, approved by the owner,
// and imported with `pnpm illustrations:import`. A story with no map, chart or real photo gets
// the best match for its section and words instead of a plain title card. They are generic
// pictures of a kind of thing, never the scene of the story, and always labeled
// "Illustration (AI-generated)". Public safety has none: a drawing beside crime news editorializes.
//
// The shot list (docs/brand/illustration-shot-list.md) is generated from this file
// (`pnpm illustrations:shotlist`), so the prompts and the router never drift apart.
//
// Default images (docs/plans/default-images.md, owner approved 2026-10-17): shots carry the kinds
// of code-built story they're made for (`kinds`), so a weekly roundup rotates through its own set,
// and a few calm `fallback` scenes per section serve stories whose words match no tag. A shot can
// be made more than once: `<id>-2`, and a photorealistic version `<id>-p` (or `-p2`), each its
// own library file, all counted as one scene by the no-repeat rule.

import type { StoryKind } from './images';

/** Sections a library illustration can serve: news beats plus evergreen guides. */
export type IllustrationSection =
  'government' | 'development' | 'business' | 'schools' | 'community' | 'weather' | 'guide';

export type IllustrationShot = {
  /** File name and key, e.g. "gov-01". */
  id: string;
  sections: readonly IllustrationSection[];
  /** "any" fits every town; a state code limits it to towns there (palms, beaches). */
  region: 'any' | 'FL';
  /** Words in a headline or dek that make this the better match. */
  tags: readonly string[];
  /** What to draw, for the prompt. */
  scene: string;
  /** Code-built story kinds this shot is made for; they're matched before the section. */
  kinds: readonly StoryKind[];
  /** A calm, generic scene of its sections, for stories whose words match no tag. */
  fallback: boolean;
};

/** One style for every illustration, so the library reads as one set. */
export const ILLUSTRATION_STYLE =
  'Flat editorial illustration in a clean vector style with a subtle paper grain, soft daylight ' +
  'and gentle shadows. Limited palette: ocean blue, deep navy, sand, warm white, muted sage ' +
  'green, with small coral accents. Landscape, 3:2. No text, letters, numbers, logos, brand ' +
  'names, flags or signs with writing; any signs are blank. No recognizable real buildings or ' +
  'landmarks. People only small, seen from behind or far away, with no faces. Not ' +
  'photorealistic; it should read clearly as an illustration. Keep the main subject centered with ' +
  'room at the top and bottom, since pages crop it to 16:9.';

export function shotPrompt(shot: Pick<IllustrationShot, 'scene'>): string {
  return `${ILLUSTRATION_STYLE}\n\nScene: ${shot.scene}`;
}

/**
 * The photorealistic version of a scene (owner, 2026-10-16 and 2026-10-17: photorealistic AI
 * images are allowed, and some go in each batch). Same rules: generic, no text, faces or real
 * places, never presented as the story's scene.
 */
export const PHOTO_STYLE =
  'Photorealistic photograph with natural daylight, true-to-life color and a shallow depth of ' +
  'field, like a good local newspaper photo. Landscape, 3:2. No text, letters, numbers, logos, ' +
  'brand names, flags or signs with writing; any signs are blank. Generic, not any real, ' +
  'recognizable building, landmark or street. People only small, seen from behind or far away, ' +
  'with no faces. Keep the main subject centered with room at the top and bottom, since pages ' +
  'crop it to 16:9.';

export function photoPrompt(shot: Pick<IllustrationShot, 'scene'>): string {
  return `${PHOTO_STYLE}\n\nScene: ${shot.scene}`;
}

/**
 * The shot a library file belongs to: `sale-01`, `sale-01-2`, `sale-01-p` and `sale-01-p2` are
 * all `sale-01`. Null for a name that isn't a shot.
 */
export function shotIdOf(fileId: string, ids: ReadonlySet<string> = shotIds): string | null {
  if (ids.has(fileId)) return fileId;
  const m = fileId.match(/^(.+)-(p\d*|\d+)$/);
  return m && ids.has(m[1]!) ? m[1]! : null;
}

/** A library file made from the photorealistic prompt. */
export const isPhotoVariant = (fileId: string) => /-p\d*$/.test(fileId);

type Row = [
  id: string,
  sections: IllustrationSection[],
  region: 'any' | 'FL',
  tags: string,
  scene: string,
  options?: { kinds?: StoryKind[]; fallback?: boolean },
];

const rows: Row[] = [
  // Government: meetings, budgets, votes, city services.
  [
    'gov-01',
    ['government'],
    'any',
    'commission council meeting agenda vote',
    'An empty city council dais seen from the public seats: a curved wooden desk with a row of microphones and blank nameplates, a clock on the wall.',
  ],
  [
    'gov-02',
    ['government'],
    'any',
    'commission council meeting public comment hearing',
    'A public comment podium with a single microphone facing a council dais, rows of empty audience chairs in the foreground.',
  ],
  [
    'gov-03',
    ['government'],
    'any',
    'vote approved approves ordinance resolution',
    'Close-up of a wooden gavel resting on its block beside a stack of papers and a microphone on a council desk.',
  ],
  [
    'gov-04',
    ['government'],
    'any',
    'agenda meeting workshop minutes',
    'A meeting agenda packet, a laptop and a coffee cup on a long conference table, chairs pushed in, afternoon light through tall windows.',
  ],
  [
    'gov-05',
    ['government'],
    'any',
    'budget millions tax taxes millage spending fiscal',
    'A budget binder open beside a calculator, a pencil and a few neat stacks of coins on a desk.',
  ],
  [
    'gov-06',
    ['government'],
    'any',
    'budget revenue spending financial audit',
    'A simple bar chart drawn on a whiteboard with no labels, beside a desk with spreadsheets and a pen.',
  ],
  [
    'gov-07',
    ['government'],
    'FL',
    'city hall city government',
    'A generic Mediterranean-style municipal building with a barrel-tile roof, arched entry and palm trees, under a clear blue sky.',
  ],
  [
    'gov-08',
    ['government'],
    'any',
    'city hall city government town',
    'A generic civic building with columns and wide front steps, a few trees and an empty plaza in front.',
  ],
  [
    'gov-09',
    ['government'],
    'any',
    'election elections ballot candidates vote voters',
    'A ballot box with a slot on a table in a quiet polling place, privacy booths in the background.',
  ],
  [
    'gov-10',
    ['government'],
    'any',
    'election voting polls early voting',
    'A row of voting booths with blue privacy screens in a school gym, seen from a distance.',
  ],
  [
    'gov-11',
    ['government'],
    'any',
    'town hall forum residents meeting',
    'Rows of residents seen from behind at a community meeting, facing a small stage with a projector screen showing a blank slide.',
  ],
  [
    'gov-12',
    ['government'],
    'any',
    'water utility utilities rates sewer',
    'A municipal water treatment plant with round clarifier tanks and pipes, viewed from above at a gentle angle.',
  ],
  [
    'gov-13',
    ['government'],
    'any',
    'trash garbage recycling sanitation pickup',
    'A city garbage truck lifting a curbside bin on a quiet residential street in the morning.',
  ],
  [
    'gov-14',
    ['government', 'guide'],
    'any',
    'recycling trash bins collection schedule',
    'Three curbside bins (blue, green and gray) lined up at the end of a driveway on collection day.',
  ],
  [
    'gov-15',
    ['government'],
    'any',
    'streetlights lighting infrastructure',
    'A row of streetlights along a quiet avenue at dusk, the first lights just coming on.',
  ],
  [
    'gov-16',
    ['government'],
    'any',
    'zoning map rezoning land use comprehensive plan',
    'A large zoning map spread on a table with colored zones and pushpins, a ruler and a pencil.',
  ],
  [
    'gov-17',
    ['government', 'development'],
    'any',
    'public notice hearing variance',
    'A blank public-notice sign staked in a grassy lot beside a sidewalk.',
  ],
  [
    'gov-18',
    ['government', 'community'],
    'any',
    'library libraries',
    'A bright public library interior with tall shelves, reading tables and large windows, nobody in sight.',
  ],
  [
    'gov-19',
    ['government', 'community'],
    'any',
    'community center recreation',
    'A low modern community center building with a covered entrance, bike racks and young trees.',
  ],
  [
    'gov-20',
    ['government'],
    'any',
    'contract contracts bid bids procurement agreement',
    'A signed contract on a desk with a fountain pen, a folder and reading glasses.',
  ],
  [
    'gov-21',
    ['government'],
    'any',
    'appointed appointment board committee advisory',
    'An empty board table with name tents left blank, water glasses and microphones, in a small meeting room.',
  ],
  [
    'gov-22',
    ['government'],
    'any',
    'parks recreation maintenance',
    'City parks crew truck parked by a freshly mowed field, a mower and orange cones beside it.',
  ],
  [
    'gov-23',
    ['government'],
    'any',
    'transportation transit bus route',
    'A city bus at a covered bus stop on a sunny street, no passengers visible.',
  ],
  [
    'gov-24',
    ['government', 'development'],
    'any',
    'traffic signal intersection road safety',
    'A traffic signal over a quiet four-way intersection with crosswalk stripes, seen from a corner.',
  ],
  [
    'gov-25',
    ['government'],
    'any',
    'property tax taxes assessment appraiser',
    'A property tax bill envelope on a kitchen table next to a calculator and house keys.',
  ],
  [
    'gov-26',
    ['government'],
    'any',
    'police fire station budget public safety funding',
    'A generic municipal services building with large garage doors and a flagpole with no flag, seen from the street.',
  ],
  [
    'gov-27',
    ['government'],
    'any',
    'county commission county',
    'A larger county government building with a broad stair and a fountain, trees on both sides.',
  ],
  [
    'gov-28',
    ['government'],
    'any',
    'state legislature law bill',
    'A domed state capitol-style building drawn generically, not any real capitol, with lawn and walkways.',
  ],
  [
    'gov-29',
    ['government'],
    'any',
    'mayor proclamation ceremony',
    'A small ceremony podium with a microphone set up outdoors on a plaza, folding chairs in rows.',
  ],
  [
    'gov-30',
    ['government'],
    'FL',
    'seawall sea level resilience stormwater',
    'A concrete seawall along a calm canal with docks, mangroves and a raised walkway.',
  ],
  // Development: construction, permits, housing, roads.
  [
    'dev-01',
    ['development'],
    'any',
    'construction tower high-rise crane',
    'Two tower cranes over a half-built mid-rise concrete building against a blue sky.',
  ],
  [
    'dev-02',
    ['development'],
    'any',
    'construction site project',
    'A construction site behind a chain-link fence wrapped in plain blue mesh, an excavator and stacks of materials inside.',
  ],
  [
    'dev-03',
    ['development', 'guide'],
    'any',
    'permit permits building plans application',
    'Rolled and open blueprints on a drafting table with a hard hat, a tape measure and a pencil.',
  ],
  [
    'dev-04',
    ['development'],
    'any',
    'excavation site work groundbreaking',
    'A yellow excavator digging a foundation hole on a cleared lot, dirt piles and orange barriers.',
  ],
  [
    'dev-05',
    ['development'],
    'any',
    'home house new construction residential single-family',
    'The wood framing of a new two-story house, ladders and lumber stacks around it.',
  ],
  [
    'dev-06',
    ['development'],
    'any',
    'concrete foundation slab',
    'A concrete truck pouring a foundation slab, workers far in the background with rakes.',
  ],
  [
    'dev-07',
    ['development', 'government'],
    'any',
    'road repaving resurfacing street work',
    'A paving machine and roller laying fresh asphalt on a two-lane road, traffic cones along the edge.',
  ],
  [
    'dev-08',
    ['development', 'government'],
    'any',
    'lane closure road closure detour',
    'Orange traffic cones and a blank detour sign closing one lane of a city street.',
  ],
  [
    'dev-09',
    ['development'],
    'any',
    'apartment apartments rental units housing',
    'A new four-story apartment building with balconies and young street trees, freshly landscaped.',
  ],
  [
    'dev-10',
    ['development'],
    'any',
    'townhomes townhouses',
    'A row of new townhouses with small front gardens and identical front doors in soft colors.',
  ],
  [
    'dev-11',
    ['development'],
    'any',
    'mixed-use retail residential downtown',
    'A mixed-use building with shops at street level (blank awnings) and apartments above.',
  ],
  [
    'dev-12',
    ['development'],
    'FL',
    'condo condominium waterfront',
    'A white modern condominium tower by the water with palms and a pool deck.',
  ],
  [
    'dev-13',
    ['development'],
    'any',
    'site plan plan approval architect rendering',
    "An architect's scale model of a small development on a table, tiny trees and buildings, a lamp overhead.",
  ],
  [
    'dev-14',
    ['development'],
    'any',
    'survey land parcel lot',
    "A surveyor's tripod and instrument on an empty grassy lot with stakes and pink flagging tape.",
  ],
  [
    'dev-15',
    ['development'],
    'any',
    'roundabout traffic road project',
    'An aerial view of a small roundabout with landscaped center and four approaching roads.',
  ],
  [
    'dev-16',
    ['development', 'government'],
    'any',
    'sidewalk bike lane complete streets',
    'A new sidewalk and green-painted bike lane along a street, freshly planted trees.',
  ],
  [
    'dev-17',
    ['development', 'government'],
    'any',
    'drainage stormwater pipes flooding project',
    'Large concrete drainage pipes stacked beside an open trench on a street project.',
  ],
  [
    'dev-18',
    ['development'],
    'any',
    'solar roof renovation remodel',
    'Workers far off on a roof installing solar panels on a suburban house.',
  ],
  [
    'dev-19',
    ['development'],
    'FL',
    'pool swimming pool permit',
    'A new backyard swimming pool under construction, gunite shell and rebar, a palm nearby.',
  ],
  [
    'dev-20',
    ['development'],
    'FL',
    'dock marina boat lift',
    'A wooden dock and boat lift being built on a calm canal behind a house.',
  ],
  [
    'dev-21',
    ['development'],
    'any',
    'demolition demolish teardown',
    'An excavator demolishing a small old commercial building, a pile of rubble and a dust cloud.',
  ],
  [
    'dev-22',
    ['development'],
    'any',
    'renovation remodel interior',
    'A gutted interior room with exposed studs, a ladder, drop cloths and paint cans.',
  ],
  [
    'dev-23',
    ['development'],
    'any',
    'housing affordable workforce',
    'A friendly low-rise apartment courtyard with benches, bikes and laundry on balconies.',
  ],
  [
    'dev-24',
    ['development'],
    'any',
    'shopping center plaza retail redevelopment',
    'A strip shopping plaza with blank storefront signs and a mostly empty parking lot.',
  ],
  [
    'dev-25',
    ['development'],
    'any',
    'hotel hospitality',
    'A modern mid-size hotel with a covered drop-off and a row of potted trees, no signage.',
  ],
  // Business: openings, licenses, filings, trades, dining.
  [
    'biz-01',
    ['business'],
    'any',
    'opening opens grand opening new business',
    'A ribbon stretched across a shop door with oversized scissors on a small table, balloons beside it.',
  ],
  [
    'biz-02',
    ['business'],
    'any',
    'restaurant dining eat food',
    'A warm restaurant dining room with set tables, pendant lights and an open kitchen in the back.',
  ],
  [
    'biz-03',
    ['business'],
    'any',
    'restaurant chef kitchen food',
    "A chef's hands plating a dish in a stainless steel kitchen, steam rising, no face visible.",
  ],
  [
    'biz-04',
    ['business'],
    'any',
    'coffee cafe bakery',
    'A café counter with an espresso machine, pastries in a glass case and chalkboard menus left blank.',
  ],
  [
    'biz-05',
    ['business'],
    'any',
    'bakery bread pastry',
    'Shelves of fresh bread loaves and baskets of rolls in a small bakery.',
  ],
  [
    'biz-06',
    ['business'],
    'FL',
    'outdoor dining patio restaurant',
    'An outdoor dining patio with umbrellas, potted palms and string lights at golden hour.',
  ],
  [
    'biz-07',
    ['business', 'community'],
    'any',
    'food truck',
    'A food truck with an open service window parked by a park, picnic tables nearby.',
  ],
  [
    'biz-08',
    ['business'],
    'any',
    'retail boutique shop store clothing',
    'A boutique interior with clothing racks, folded sweaters on a table and a big front window.',
  ],
  [
    'biz-09',
    ['business'],
    'any',
    'hardware store retail',
    'A hardware store aisle with neatly hung tools, paint cans and a ladder display.',
  ],
  [
    'biz-10',
    ['business'],
    'any',
    'salon barber beauty',
    'A salon with two styling chairs, mirrors and plants, empty and tidy.',
  ],
  [
    'biz-11',
    ['business'],
    'any',
    'gym fitness studio yoga',
    'A bright fitness studio with mats, dumbbells on a rack and tall windows.',
  ],
  [
    'biz-12',
    ['business'],
    'any',
    'dentist dental medical clinic doctor health',
    'A clean dental exam room with a reclined chair and a lamp, no people.',
  ],
  [
    'biz-13',
    ['business'],
    'any',
    'contractor contractors licensed license construction trade',
    'A work van with a ladder rack and an open back full of neatly organized tools, plain white with no lettering.',
  ],
  [
    'biz-14',
    ['business'],
    'any',
    'plumber plumbing',
    "A plumber's toolbox, pipe wrench and copper fittings on a floor under a kitchen sink.",
  ],
  [
    'biz-15',
    ['business'],
    'any',
    'electrician electrical',
    'An open electrical panel with neat wiring, a voltage tester and a coil of wire beside it.',
  ],
  [
    'biz-16',
    ['business'],
    'any',
    'landscaping lawn care tree',
    "A landscaping crew's trailer with mowers and trimmers parked by a manicured lawn.",
  ],
  [
    'biz-17',
    ['business'],
    'FL',
    'pool service pool cleaning',
    'A pool service pole, brush and chemical kit beside a sparkling backyard pool.',
  ],
  [
    'biz-18',
    ['business'],
    'any',
    'real estate home sale sold realtor',
    'A blank for-sale sign in the front lawn of a tidy single-family house.',
  ],
  [
    'biz-19',
    ['business'],
    'any',
    'filings corporations llc incorporated new businesses',
    'A stack of stamped business filing papers, a rubber stamp and a pen on a desk.',
  ],
  [
    'biz-20',
    ['business'],
    'any',
    'license licenses licensed state',
    'A framed certificate with no readable text hanging on an office wall above a desk.',
  ],
  [
    'biz-21',
    ['business', 'community'],
    'any',
    'farmers market market vendors',
    'Farmers market stalls with produce crates and canopies, shoppers small in the distance.',
  ],
  [
    'biz-22',
    ['business'],
    'any',
    'small business shop owner register',
    'Hands at a shop counter wrapping a purchase in paper beside a card reader.',
  ],
  [
    'biz-23',
    ['business'],
    'any',
    'office coworking professional services law accounting',
    'A quiet office with desks, monitors and plants, morning light through blinds.',
  ],
  [
    'biz-24',
    ['business'],
    'any',
    'closing closed closure',
    'A storefront with brown paper over the windows and an empty interior, no signage.',
  ],
  [
    'biz-25',
    ['business'],
    'any',
    'auto repair car mechanic',
    'An auto repair bay with a car on a lift and a rolling tool chest.',
  ],
  // Schools.
  [
    'sch-01',
    ['schools'],
    'any',
    'school bus transportation students',
    'A yellow school bus at a curbside stop on a tree-lined street, no children visible.',
  ],
  [
    'sch-02',
    ['schools'],
    'any',
    'classroom teachers teacher class',
    "An empty classroom with desks in rows, a blank whiteboard and a globe on the teacher's desk.",
  ],
  [
    'sch-03',
    ['schools'],
    'any',
    'school campus elementary middle high',
    'A generic one-story school building with a covered walkway, a flagpole with no flag and a lawn.',
  ],
  [
    'sch-04',
    ['schools'],
    'any',
    'school board district superintendent',
    'A school board meeting table with microphones and blank nameplates, a projector screen behind.',
  ],
  [
    'sch-05',
    ['schools'],
    'any',
    'students backpacks enrollment',
    'A row of colorful backpacks hanging on hooks along a school hallway.',
  ],
  [
    'sch-06',
    ['schools'],
    'any',
    'science stem lab',
    'A school science lab with beakers, a microscope and a periodic-table-style poster with no readable text.',
  ],
  [
    'sch-07',
    ['schools'],
    'any',
    'graduation graduates ceremony',
    'Graduation caps tossed in the air against a blue sky, seen from below.',
  ],
  [
    'sch-08',
    ['schools'],
    'any',
    'cafeteria lunch meals',
    'An empty school cafeteria with long tables and trays stacked at the end of a serving line.',
  ],
  [
    'sch-09',
    ['schools'],
    'any',
    'crossing guard school zone safety',
    'A school-zone crosswalk with a crossing guard seen from behind holding a stop paddle.',
  ],
  [
    'sch-10',
    ['schools'],
    'any',
    'athletics sports field stadium',
    'Empty bleachers beside a school football field with fresh white lines.',
  ],
  [
    'sch-11',
    ['schools'],
    'any',
    'music band arts program',
    'Music stands and folding chairs in a band room, a few instrument cases on the floor.',
  ],
  [
    'sch-12',
    ['schools'],
    'any',
    'art students program',
    'An art classroom table with paint jars, brushes and paper, aprons on hooks.',
  ],
  [
    'sch-13',
    ['schools'],
    'any',
    'scores grades testing exams',
    'A pencil, an answer sheet with bubbles (no text) and a timer on a student desk.',
  ],
  [
    'sch-14',
    ['schools'],
    'any',
    'college university campus',
    'A generic college quad with brick buildings, trees and paths crossing the lawn.',
  ],
  [
    'sch-15',
    ['schools'],
    'any',
    'school year calendar first day',
    'A school hallway with lockers and morning sunlight, a bulletin board with blank paper.',
  ],
  // Community: parks, events, beach, recreation.
  [
    'com-01',
    ['community'],
    'any',
    'park parks playground',
    'A neighborhood park playground with a slide and swings, shade trees and benches.',
  ],
  [
    'com-02',
    ['community'],
    'any',
    'dog park dogs pets',
    'A fenced dog park with a few dogs playing and their owners small in the background.',
  ],
  [
    'com-03',
    ['community'],
    'any',
    'trail bike path greenway',
    'A paved multi-use trail curving through trees with a cyclist far in the distance.',
  ],
  [
    'com-04',
    ['community', 'weather'],
    'FL',
    'beach beaches',
    'A wide sandy beach with turquoise water, a lifeguard tower painted plain and a few umbrellas.',
  ],
  [
    'com-05',
    ['community'],
    'FL',
    'beach boardwalk dune',
    'A wooden dune crossover boardwalk leading over sea oats to the beach.',
  ],
  [
    'com-06',
    ['community'],
    'FL',
    'pier fishing',
    'A long fishing pier stretching into the ocean, a few anglers small at the far end.',
  ],
  [
    'com-07',
    ['community'],
    'FL',
    'kayak paddle mangroves nature preserve',
    'Two kayaks gliding along a mangrove channel, viewed from behind.',
  ],
  [
    'com-08',
    ['community'],
    'any',
    'garden community garden volunteers',
    'Raised beds in a community garden with tomato cages, watering cans and a small shed.',
  ],
  [
    'com-09',
    ['community'],
    'any',
    'concert music festival amphitheater',
    'An outdoor amphitheater stage at dusk with lights, an audience on the lawn seen from behind.',
  ],
  [
    'com-10',
    ['community'],
    'any',
    'festival fair event events',
    'White festival tents on a green with bunting strung between trees, people small in the distance.',
  ],
  [
    'com-11',
    ['community'],
    'any',
    'volunteers cleanup volunteer',
    'Volunteers seen from behind picking up litter along a shoreline with bags and grabbers.',
  ],
  [
    'com-12',
    ['community'],
    'FL',
    'fireworks fourth of july new year',
    'Fireworks bursting over calm water with palm silhouettes in the foreground.',
  ],
  [
    'com-13',
    ['community'],
    'FL',
    'holiday holidays lights tree lighting',
    'Palm trees wrapped in white holiday lights along a plaza at night.',
  ],
  [
    'com-14',
    ['community'],
    'any',
    'pickleball tennis courts',
    'Outdoor pickleball courts with nets and paddles resting on a bench.',
  ],
  [
    'com-15',
    ['community'],
    'any',
    'golf course',
    'A golf green with a flagstick (no number or text) and a sand trap, palms or oaks around it.',
  ],
  [
    'com-16',
    ['community'],
    'any',
    'museum exhibit art gallery',
    'A gallery room with abstract paintings on white walls and a bench in the middle.',
  ],
  [
    'com-17',
    ['community'],
    'any',
    'theater theatre performance arts',
    'Rows of red theater seats facing a stage with the curtain closed.',
  ],
  [
    'com-18',
    ['community'],
    'any',
    'seniors senior center aging',
    'Two older adults seen from behind on a park bench watching a pond with ducks.',
  ],
  [
    'com-19',
    ['community'],
    'any',
    'pets adoption animal shelter',
    'A friendly dog and a cat sitting in an adoption room with blankets and toys.',
  ],
  [
    'com-20',
    ['community'],
    'any',
    'parade celebration',
    'A small-town parade float and marching band seen from far down the street.',
  ],
  // Weather.
  [
    'wx-01',
    ['weather'],
    'FL',
    'sunny sunshine clear warm',
    'A bright sunny sky over palm trees and a calm blue ocean.',
  ],
  [
    'wx-02',
    ['weather'],
    'FL',
    'storm storms thunderstorm thunderstorms',
    'Dark storm clouds rolling in over a beach, palm trees bending, the sea turning gray.',
  ],
  [
    'wx-03',
    ['weather'],
    'any',
    'rain rainy showers',
    'Rain streaking down a window with a blurred street and umbrellas outside.',
  ],
  [
    'wx-04',
    ['weather'],
    'any',
    'rain showers umbrella',
    'A city sidewalk in the rain with people under umbrellas, seen from behind, reflections on the pavement.',
  ],
  [
    'wx-05',
    ['weather'],
    'any',
    'lightning thunderstorm',
    'A lightning bolt over open water at night under heavy clouds.',
  ],
  [
    'wx-06',
    ['weather', 'guide'],
    'FL',
    'hurricane tropical storm tropics',
    'A stylized hurricane spiral seen from space over a generic blue sea, drawn like an illustration, not a real map.',
  ],
  [
    'wx-07',
    ['weather', 'guide'],
    'FL',
    'hurricane preparation shutters',
    'Hurricane shutters closed over windows of a house, sandbags at the door.',
  ],
  [
    'wx-08',
    ['weather'],
    'any',
    'heat hot heat advisory temperatures',
    'A thermometer against a blazing sun and a pale, hazy sky.',
  ],
  [
    'wx-09',
    ['weather'],
    'FL',
    'rip current surf hazard warning',
    'Red warning flags on poles at an empty beach, choppy surf beyond.',
  ],
  [
    'wx-10',
    ['weather'],
    'FL',
    'sunrise morning',
    'Sunrise over the ocean with soft pink and orange clouds and a calm sea.',
  ],
  [
    'wx-11',
    ['weather'],
    // The imported image has palm trees (owner's batch, 2026-10-16), so Florida only.
    'FL',
    'sunset evening',
    'A warm sunset over a quiet street with silhouetted trees and power lines.',
  ],
  [
    'wx-12',
    ['weather'],
    'any',
    'fog foggy morning',
    'Morning fog over a lake and a footbridge, everything soft and pale.',
  ],
  [
    'wx-13',
    ['weather'],
    // The imported image has palm trees (owner's batch, 2026-10-16), so Florida only.
    'FL',
    'wind windy gusts',
    'Trees bending in strong wind, leaves flying, clouds racing across the sky.',
  ],
  [
    'wx-14',
    ['weather'],
    'any',
    'cold front cool cooler',
    'A crisp clear morning with a light jacket on a park bench and a few fallen leaves.',
  ],
  [
    'wx-15',
    ['weather'],
    'any',
    'uv sunscreen sun protection',
    'A beach towel, sunscreen bottle (blank label), sunglasses and a hat on the sand.',
  ],
  [
    'wx-16',
    ['weather'],
    'any',
    'rainbow clearing',
    'A rainbow over wet rooftops after rain, the sky clearing.',
  ],
  [
    'wx-17',
    ['weather', 'guide'],
    'any',
    'flood flooding flood watch',
    'A street with deep puddles after heavy rain, a storm drain and a car parked on higher ground.',
  ],
  [
    'wx-18',
    ['weather'],
    'FL',
    'tide tides king tide high tide',
    'High tide reaching the top of a seawall along a canal, water calm and glassy.',
  ],
  [
    'wx-19',
    ['weather'],
    'any',
    'forecast weekend weather',
    'A wide sky with fair-weather clouds over a town park and a pond.',
  ],
  [
    'wx-20',
    ['weather'],
    'any',
    'air quality smoke haze',
    'A hazy sky softening the outline of trees and rooftops.',
  ],
  // Guides: how-to topics.
  [
    'gd-01',
    ['guide'],
    'any',
    'water bill utility account',
    'A utility bill envelope, a water meter cover in grass and a smartphone on a table.',
  ],
  [
    'gd-02',
    ['guide'],
    'any',
    'voter registration register vote',
    'A blank voter registration card, a pen and a mailing envelope on a desk.',
  ],
  [
    'gd-03',
    ['guide'],
    'any',
    'library card library',
    'A library card (blank), a stack of borrowed books and a tote bag.',
  ],
  [
    'gd-04',
    ['guide'],
    'any',
    'parking permit parking',
    'A parking meter beside a curb with a car parked in the background.',
  ],
  [
    'gd-05',
    ['guide'],
    'any',
    'pet license dog registration',
    'A dog sitting by a door with a leash and a blank tag on its collar.',
  ],
  [
    'gd-06',
    ['guide'],
    'any',
    'park reservation pavilion rental',
    'A covered picnic pavilion with tables in a park, no one there yet.',
  ],
  [
    'gd-07',
    ['guide'],
    'FL',
    'boat ramp boating launch',
    'A boat ramp sloping into a calm waterway, a trailer and truck backing down.',
  ],
  [
    'gd-08',
    ['guide'],
    'FL',
    'beach parking beach access',
    'A small beach parking lot under sea grape trees with a path to the sand.',
  ],
  [
    'gd-09',
    ['guide'],
    'any',
    'emergency alerts notifications sign up',
    'A smartphone showing a blank alert banner on a kitchen counter next to keys.',
  ],
  [
    'gd-10',
    ['guide'],
    'any',
    'hurricane kit emergency supplies preparedness',
    'Emergency supplies laid out: water jugs, flashlight, batteries, a first-aid kit and canned food.',
  ],
  [
    'gd-11',
    ['guide'],
    'any',
    'property tax homestead exemption',
    'House keys on a closing folder next to a small model house.',
  ],
  [
    'gd-12',
    ['guide'],
    'any',
    'bulk pickup yard waste',
    'Bundled yard trimmings and a piece of old furniture set out neatly at the curb.',
  ],
  [
    'gd-13',
    ['guide'],
    'any',
    'report problem pothole streetlight service request',
    'A pothole on a residential street with a phone held up to photograph it, hand only.',
  ],
  [
    'gd-14',
    ['guide'],
    'any',
    'business tax receipt license open business',
    'An open laptop with a blank form on screen, a coffee and a notepad on a small business counter.',
  ],
  [
    'gd-15',
    ['guide'],
    'any',
    'trees tree removal permit',
    "A large shade tree in a front yard with an arborist's truck parked at the curb.",
  ],
  // Default images by story kind (docs/plans/default-images.md, 2026-10-17).
  // Property sales.
  [
    'sale-01',
    ['development'],
    'any',
    'home house sold sale buyer',
    'A tidy single-family house with a front porch, a potted plant and two moving boxes by the door.',
    { kinds: ['roundup:sales'] },
  ],
  [
    'sale-02',
    ['development'],
    'any',
    'keys home sale',
    'A ring of house keys hanging from the lock of a painted front door.',
    { kinds: ['roundup:sales'] },
  ],
  [
    'sale-03',
    ['development'],
    'any',
    'neighborhood homes houses',
    'A quiet residential street of varied houses and front lawns, seen from the sidewalk.',
    { kinds: ['roundup:sales'] },
  ],
  [
    'sale-04',
    ['development'],
    'any',
    'listing yard sign home',
    'A post-and-arm yard sign with a blank panel on a front lawn, the house soft behind it.',
    { kinds: ['roundup:sales'] },
  ],
  [
    'sale-05',
    ['development'],
    'any',
    'neighborhood rooftops homes',
    'Rooftops of a residential neighborhood from a gentle aerial angle, trees between them.',
    { kinds: ['roundup:sales'] },
  ],
  [
    'sale-06',
    ['development'],
    'FL',
    'waterfront canal home',
    'A low white house on a canal with a small dock and one palm tree.',
    { kinds: ['roundup:sales'] },
  ],
  // Building permits.
  [
    'perm-01',
    ['development'],
    'any',
    'permit permits plans blueprints',
    'Rolled blueprints, a hard hat and a tape measure on a plywood work table.',
    { kinds: ['roundup:permits', 'spotlight:permit'] },
  ],
  [
    'perm-02',
    ['development'],
    'any',
    'renovation addition scaffolding',
    'A two-story house wrapped in scaffolding during renovation, tarps on the lawn.',
    { kinds: ['roundup:permits'] },
  ],
  [
    'perm-03',
    ['development'],
    'any',
    'new construction framing house',
    'A new wood-framed house against a blue sky, stacks of lumber in front.',
    { kinds: ['roundup:permits', 'spotlight:permit'] },
  ],
  // New business filings.
  [
    'nb-01',
    ['business'],
    'any',
    'new business opening shop',
    'A small storefront at morning, a person seen from behind unlocking the glass door; the awning is blank.',
    { kinds: ['roundup:new-businesses'] },
  ],
  [
    'nb-02',
    ['business'],
    'any',
    'storefronts shops small business',
    'A row of small storefronts with blank awnings and planters along a sidewalk.',
    { kinds: ['roundup:new-businesses'] },
  ],
  [
    'nb-03',
    ['business'],
    'any',
    'filings llc registered',
    'A small home-office desk with an open laptop showing a blank form, a coffee and a folder.',
    { kinds: ['roundup:new-businesses'] },
  ],
  [
    'nb-04',
    ['business'],
    'any',
    'new shop opening',
    'A bunch of balloons tied to a blank sandwich board outside a new shop.',
    { kinds: ['roundup:new-businesses'] },
  ],
  // New contractor licenses.
  [
    'lic-01',
    ['business'],
    'any',
    'contractor contractors van',
    "A contractor's white work van with ladders on its roof rack, parked at a curb; no lettering.",
    { kinds: ['roundup:new-licenses'] },
  ],
  [
    'lic-02',
    ['business'],
    'any',
    'contractor tools trade',
    'A tool belt, gloves and a hard hat on the tailgate of a pickup.',
    { kinds: ['roundup:new-licenses'] },
  ],
  [
    'lic-03',
    ['business'],
    'any',
    'painter painting contractor',
    'Paint cans, rollers and a folded drop cloth on a porch step.',
    { kinds: ['roundup:new-licenses'] },
  ],
  // New places to eat and drink.
  [
    'np-01',
    ['business'],
    'any',
    'bar liquor drinks lounge',
    'A bar counter with empty stools, glasses on a shelf and warm pendant lights.',
    { kinds: ['roundup:new-places'] },
  ],
  [
    'np-02',
    ['business'],
    'any',
    'restaurant dining table',
    'A small table set for two by a restaurant window, menus closed with blank covers.',
    { kinds: ['roundup:new-places'] },
  ],
  // Restaurant inspections (the weekly roundup only; never beside one named place).
  [
    'insp-01',
    ['business'],
    'any',
    'inspection inspections kitchen',
    'A spotless stainless-steel restaurant kitchen line, empty, under bright light.',
    { kinds: ['roundup:inspections'] },
  ],
  [
    'insp-02',
    ['business'],
    'any',
    'inspection food safety temperature',
    'A probe thermometer resting on a steel prep counter beside a cutting board.',
    { kinds: ['roundup:inspections'] },
  ],
  [
    'insp-03',
    ['business'],
    'any',
    'inspection hand washing sink',
    'A hand-washing sink with a soap dispenser and paper towels in a commercial kitchen.',
    { kinds: ['roundup:inspections'] },
  ],
  [
    'insp-04',
    ['business'],
    'any',
    'inspection checklist',
    'A clipboard with a blank checklist on a steel counter, a pen clipped to it.',
    { kinds: ['roundup:inspections'] },
  ],
  [
    'insp-05',
    ['business'],
    'any',
    'inspection cooler storage',
    'A walk-in cooler with shelves of lidded containers with blank labels, the door open.',
    { kinds: ['roundup:inspections'] },
  ],
  [
    'insp-06',
    ['business'],
    'any',
    'inspection gloves hairnets',
    'Boxes of disposable gloves and hairnets on a shelf by a kitchen door.',
    { kinds: ['roundup:inspections'] },
  ],
  // Road work.
  [
    'road-01',
    ['development'],
    'any',
    'lane closure cones road work',
    'A line of orange cones and barrels narrowing a lane on a suburban road.',
    { kinds: ['roundup:roads'] },
  ],
  [
    'road-02',
    ['development'],
    'any',
    'paving repaving asphalt',
    'A paving machine and roller laying fresh asphalt, steam rising.',
    { kinds: ['roundup:roads'] },
  ],
  [
    'road-03',
    ['development'],
    'any',
    'night work road work',
    'Road work at night under work lights, a blank arrow board on a truck.',
    { kinds: ['roundup:roads'] },
  ],
  // Meetings this week.
  [
    'mtg-01',
    ['government'],
    'any',
    'meetings agenda agendas',
    'A stack of agenda folders on the end of an empty row of chairs in a meeting room.',
    { kinds: ['roundup:meetings'] },
  ],
  [
    'mtg-02',
    ['government'],
    'any',
    'meetings meeting room',
    'A meeting room with a projector screen showing a blank slide and rows of chairs.',
    { kinds: ['roundup:meetings'] },
  ],
  // Weather alerts.
  [
    'alrt-01',
    ['weather'],
    'any',
    'flood flooding flash sandbags',
    'Sandbags stacked across the doorway of a house, rain falling.',
    { kinds: ['alert'] },
  ],
  [
    'alrt-02',
    ['weather'],
    'any',
    'freeze frost ice icy',
    'Ice-coated branches and a frosted fence after a freezing night.',
    { kinds: ['alert'] },
  ],
  [
    'alrt-03',
    ['weather'],
    'any',
    'winter snow blizzard',
    'A snowplow clearing a residential street at dusk.',
    { kinds: ['alert'] },
  ],
  [
    'alrt-04',
    ['weather'],
    'any',
    'wind high gusts',
    'A large tree limb down on a lawn after wind, the house untouched.',
    { kinds: ['alert'] },
  ],
  [
    'alrt-05',
    ['weather'],
    'any',
    'severe storm',
    "Dark storm clouds building over a town's rooftops, the street empty.",
    { kinds: ['alert'], fallback: true },
  ],
  // Calm, generic scenes for stories whose words match no tag.
  [
    'fb-01',
    ['business', 'community'],
    'any',
    'downtown main street',
    'A wide, quiet main street of small shops and trees in morning light.',
    { fallback: true },
  ],
  [
    'fb-02',
    ['government', 'community'],
    'any',
    'town square downtown',
    'A town square with a fountain, benches and trees; no statue or monument.',
    { fallback: true },
  ],
  [
    'fb-03',
    ['community', 'development'],
    'any',
    'neighborhood evening',
    'A residential street at dusk with porch lights on.',
    { fallback: true },
  ],
  [
    'fb-04',
    ['community', 'government'],
    'any',
    'rural road mailboxes',
    'A row of mailboxes along a country road with fields behind.',
    { fallback: true },
  ],
  [
    'fb-05',
    ['community'],
    'any',
    'park bench shade',
    'A park bench under a large shade tree beside a path.',
    { fallback: true },
  ],
  [
    'fb-06',
    ['community', 'business'],
    'FL',
    'street palms downtown',
    'A quiet street lined with palms and low pastel buildings.',
    { fallback: true },
  ],
];

// Installed shots that already fit a story kind (docs/plans/default-images.md §2.2).
const KIND_SHOTS: Partial<Record<StoryKind, string[]>> = {
  'roundup:sales': ['biz-18', 'gd-11'],
  'roundup:permits': ['dev-03', 'dev-05', 'dev-18', 'dev-22'],
  'roundup:new-businesses': ['biz-01', 'biz-19', 'biz-22'],
  'roundup:new-licenses': ['biz-13', 'biz-14', 'biz-15', 'biz-20'],
  'roundup:new-places': ['biz-02', 'biz-03', 'biz-04', 'biz-05', 'biz-06', 'biz-07'],
  'roundup:roads': ['dev-07', 'dev-08', 'dev-15', 'dev-16'],
  'roundup:meetings': ['gov-01', 'gov-02', 'gov-03', 'gov-04', 'gov-11'],
  'spotlight:permit': ['dev-01', 'dev-02', 'dev-04', 'dev-06', 'dev-09', 'dev-11', 'dev-13'],
  alert: [
    'wx-02',
    'wx-03',
    'wx-04',
    'wx-06',
    'wx-07',
    'wx-08',
    'wx-09',
    'wx-13',
    'wx-14',
    'wx-17',
    'wx-20',
  ],
};
const FALLBACK_SHOTS = new Set([
  'gov-08',
  'dev-02',
  'biz-22',
  'com-01',
  'sch-03',
  'sch-05',
  'wx-19',
]);

export const illustrationShots: readonly IllustrationShot[] = rows.map(
  ([id, sections, region, tags, scene, options]) => ({
    id,
    sections,
    region,
    tags: tags.split(/\s+/).filter(Boolean),
    scene,
    kinds: [
      ...(options?.kinds ?? []),
      ...(Object.entries(KIND_SHOTS) as Array<[StoryKind, string[]]>)
        .filter(([, ids]) => ids.includes(id))
        .map(([kind]) => kind),
    ],
    fallback: options?.fallback ?? FALLBACK_SHOTS.has(id),
  }),
);

const shotIds: ReadonlySet<string> = new Set(rows.map((r) => r[0]));

/** An imported, owner-approved illustration (packages/config/src/illustrations.library.json). */
export type LibraryIllustration = {
  id: string;
  width: number;
  height: number;
  /** Written from what the image actually shows. */
  alt: string;
  /** Email of the staff member who approved it; resolved to `staff.id` for `images.approved_by`. */
  approvedBy: string;
  importedAt: string;
  /** Made from the photorealistic prompt (`<id>-p`). */
  photoreal?: boolean;
};
