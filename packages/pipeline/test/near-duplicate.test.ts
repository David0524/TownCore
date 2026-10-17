import { NEAR_DUP_MAX } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { nearDuplicateShare, normalizeWords } from '../src/near-duplicate';
import {
  inspectionsRoundup,
  meetingsRoundup,
  newBusinessesRoundup,
  newLicensesRoundup,
  newPlacesRoundup,
  permitsRoundup,
  propertySalesRoundup,
  roadWorkRoundup,
  weatherAlert,
  type TemplatedDraft,
  type TemplateRecord,
} from '../src/templates';

// The near-duplicate guard (owner, 2026-10-17; docs/plans/google-safety.md): every template built
// in code, built for two towns with their own (different) records, may share at most NEAR_DUP_MAX
// of its 8-word shingles once town names and numbers are masked. A template whose fixed sentences
// outweigh the town's own specifics fails here.

type Town = { name: string; timezone: string; agency: string };
const harbor: Town = {
  name: 'Harbor Point',
  timezone: 'America/New_York',
  agency: 'City of Harbor Point',
};
const pine: Town = {
  name: 'Pine Hollow',
  timezone: 'America/Chicago',
  agency: 'Town of Pine Hollow',
};
const week = new Date('2026-10-12T04:00:00Z');
const names = (t: Town) => [t.name, t.agency];

const rec = (over: Partial<TemplateRecord> & { id: string }): TemplateRecord => ({
  type: 'x',
  title: null,
  text: null,
  url: null,
  occurredAt: null,
  raw: {},
  ...over,
});

const text = (d: TemplatedDraft) => `${d.dek}\n\n${d.bodyMd}`;

function check(label: string, build: (t: Town, side: 0 | 1) => TemplatedDraft) {
  it(`${label} reads differently in two towns`, () => {
    const a = build(harbor, 0);
    const b = build(pine, 1);
    const share = nearDuplicateShare(
      { text: text(a), names: names(harbor) },
      { text: text(b), names: names(pine) },
    );
    expect(share, `${label}: ${(share * 100).toFixed(0)}% shared`).toBeLessThanOrEqual(
      NEAR_DUP_MAX,
    );
  });
}

// Two towns' worth of records per template: different names, places, figures and counts.
const pick = <T>(side: 0 | 1, a: T, b: T) => (side === 0 ? a : b);

describe('near-duplicate guard', () => {
  it('masks names and numbers and finds a shared template', () => {
    expect(normalizeWords('Harbor Point had 12 sales, $1,200,000.', ['Harbor Point'])).toEqual([
      'town',
      'had',
      '#',
      'sales',
      '#',
    ]);
    const tpl = (t: string, n: number) =>
      `${t} residents can expect the following changes at the next meeting of the board with ${n} items.`;
    expect(
      nearDuplicateShare(
        { text: tpl('Harbor Point', 3), names: ['Harbor Point'] },
        { text: tpl('Pine Hollow', 9), names: ['Pine Hollow'] },
      ),
    ).toBe(1);
  });

  check('meetingsRoundup', (t, side) =>
    meetingsRoundup(
      t,
      week,
      pick(
        side,
        [
          rec({
            id: 'm1',
            title: 'City Commission Regular Meeting',
            text: 'When: Tuesday, Oct. 13, 2026, 6 p.m.\nWhere: City Hall Chambers',
            occurredAt: new Date('2026-10-13T22:00:00Z'),
          }),
          rec({
            id: 'm2',
            title: 'Marina Advisory Board',
            text: 'When: Thursday, Oct. 15, 2026, 9 a.m.',
            occurredAt: new Date('2026-10-15T13:00:00Z'),
          }),
        ],
        [
          rec({
            id: 'm3',
            title: 'Planning and Zoning Commission',
            text: 'When: Monday, Oct. 12, 2026, 7 p.m.\nWhere: Town Hall',
            occurredAt: new Date('2026-10-13T00:00:00Z'),
          }),
          rec({
            id: 'm4',
            title: 'Parks and Recreation Board',
            text: 'When: Wednesday, Oct. 14, 2026, 5:30 p.m.\nWhere: Community Center',
            occurredAt: new Date('2026-10-14T22:30:00Z'),
          }),
          rec({
            id: 'm5',
            title: 'Town Council Workshop',
            text: 'When: Friday, Oct. 16, 2026, noon',
            occurredAt: new Date('2026-10-16T17:00:00Z'),
          }),
        ],
      ),
      pick(side, [3, 2, 4], [1]),
    ),
  );

  const filing = (id: string, name: string, kind: string, zip: string) =>
    rec({
      id,
      type: 'new-filing',
      title: name,
      text: `${kind}, document number ${id}, filed 10/13/2026.`,
      raw: { name, zip },
    });
  check('newBusinessesRoundup', (t, side) =>
    newBusinessesRoundup(
      t,
      week,
      pick(
        side,
        [
          filing('L1', 'SEASIDE NAIL STUDIO LLC', 'Florida Limited Liability Company', '33431'),
          filing('L2', 'MARINA BAIT AND TACKLE INC', 'Florida Profit Corporation', '33432'),
          filing('L3', 'HARBOR DENTAL GROUP PA', 'Florida Profit Corporation', '33431'),
        ],
        [
          filing('P1', 'OAK RIDGE ROOFING LLC', 'Florida Limited Liability Company', '32501'),
          filing('P2', 'PINE HOLLOW BAKERY LLC', 'Florida Limited Liability Company', '32502'),
        ],
      ),
      pick(side, [5, 3], [2, 4, 1]),
    ),
  );

  const license = (id: string, name: string, occupation: string) =>
    rec({
      id,
      type: 'license',
      raw: { licenseeName: name, occupation, alternateLicenseNumber: `CGC${id}` },
    });
  check('newLicensesRoundup', (t, side) =>
    newLicensesRoundup(
      t,
      week,
      pick(
        side,
        [
          license('1531', 'SUNCOAST BUILDERS LLC', 'Certified General Contractor'),
          license('1532', 'BRIGHT WIRE ELECTRIC', 'Certified Electrical Contractor'),
        ],
        [
          license('2201', 'GULF ROOFING CO', 'Certified Roofing Contractor'),
          license('2202', 'PANHANDLE POOLS INC', 'Certified Pool/Spa Contractor'),
          license('2203', 'NORTHWOOD HVAC', 'Certified Air Conditioning Contractor'),
        ],
      ),
      pick(side, [1, 2], [3]),
    ),
  );

  check('newPlacesRoundup', (t, side) =>
    newPlacesRoundup(
      t,
      week,
      pick(
        side,
        [
          rec({
            id: 'f1',
            type: 'new_food_license',
            raw: {
              businessName: 'THE SALTY PELICAN',
              occupation: 'Permanent Food Service, seating',
              address1: '12 HARBOR WALK',
            },
          }),
          rec({
            id: 'f2',
            type: 'new_food_license',
            raw: {
              businessName: 'MORNING TIDE COFFEE',
              occupation: 'Permanent Food Service, non-seating',
              address1: '400 E OCEAN AVE',
            },
          }),
          rec({
            id: 'l1',
            type: 'liquor_license',
            raw: {
              business: 'THE SALTY PELICAN',
              sells: 'beer and wine served on site',
              street: '12 HARBOR WALK',
            },
          }),
        ],
        [
          rec({
            id: 'f3',
            type: 'new_food_license',
            raw: {
              businessName: 'SMOKEHOUSE 98',
              occupation: 'Mobile Food Dispensing Vehicle',
              address1: '9800 HWY 98',
            },
          }),
          rec({
            id: 'l2',
            type: 'liquor_license',
            raw: {
              business: 'HOLLOW TAP ROOM',
              sells: 'beer, wine and liquor served on site',
              street: '55 MAIN ST',
            },
          }),
          rec({
            id: 'l3',
            type: 'liquor_license',
            raw: {
              business: 'CORNER PACKAGE STORE',
              sells: 'beer, wine and liquor to take home',
              street: '210 N PINE ST',
            },
          }),
        ],
      ),
      pick(side, [2, 4], [5, 3, 3]),
    ),
  );

  const visit = (id: string, business: string, severity: string, total: number, hp: number) =>
    rec({
      id,
      type: 'inspection',
      raw: {
        licenseNumber: id,
        business,
        address: `${id} MAIN ST`,
        date: '10/13/2026',
        visit: 1,
        total,
        highPriority: hp,
        severity,
      },
    });
  check('inspectionsRoundup', (t, side) =>
    inspectionsRoundup(
      t,
      week,
      pick(
        side,
        [
          visit('101', 'THE SALTY PELICAN', 'warning', 6, 1),
          visit('102', 'HARBOR SUSHI', 'ok', 0, 0),
          visit('103', 'DOCKSIDE GRILL', 'ok', 1, 0),
        ],
        [
          visit('201', 'HOLLOW TAP ROOM', 'complaint', 11, 4),
          visit('202', 'PINE DINER', 'ok', 2, 0),
          visit('203', 'SMOKEHOUSE 98', 'warning', 4, 2),
          visit('204', 'NORTHSIDE PIZZA', 'ok', 0, 0),
        ],
      ),
      pick(side, [3, 5], [6, 4, 5]),
    ),
  );

  const permit = (id: string, title: string, type: string, cost: number, contractor: string) =>
    rec({
      id,
      type: 'permit',
      title,
      text: `Type: ${type}\nEstimated cost: ${cost}\nContractor: ${contractor}`,
      url: `https://data.example.gov/d/${id}`,
    });
  check('permitsRoundup', (t, side) =>
    permitsRoundup(
      t,
      week,
      pick(
        side,
        [
          permit('a', 'New dock at 12 HARBOR WALK', 'Marine', 85000, 'COASTAL DOCKS LLC'),
          permit('b', 'Roof at 400 E OCEAN AVE', 'Roofing', 22000, 'SUNCOAST ROOFING'),
          permit('c', 'Pool at 9 SEA GRAPE LN', 'Pool', 61000, 'BLUE WAVE POOLS'),
        ],
        [
          permit('d', 'Addition at 55 MAIN ST', 'Building', 140000, 'OAK RIDGE BUILDERS'),
          permit('e', 'Demolition at 210 N PINE ST', 'Demolition', 9000, 'NORTHWOOD WRECKING'),
        ],
      ),
      pick(side, [4, 6], [2, 1, 3]),
    ),
  );

  const sale = (id: string, address: string, price: number, use: string) =>
    rec({
      id,
      type: 'sale',
      title: address,
      text: `Address: ${address}\nPrice: ${price}\nSale date: 2026-10-14\nDeed: WD\nUse: ${use}`,
      url: 'https://maps.example.gov/MapServer/1',
    });
  check('propertySalesRoundup', (t, side) =>
    propertySalesRoundup(
      t,
      week,
      pick(
        side,
        [
          sale('s1', '12 HARBOR WALK', 2400000, 'SINGLE FAMILY'),
          sale('s2', '400 E OCEAN AVE 5B', 610000, 'CONDOMINIUM'),
          sale('s3', '9 SEA GRAPE LN', 1150000, 'SINGLE FAMILY'),
        ],
        [
          sale('s4', '55 MAIN ST', 240000, 'SINGLE FAMILY'),
          sale('s5', '210 N PINE ST', 89000, 'VACANT'),
          sale('s6', '18 OAK RIDGE RD', 315000, 'SINGLE FAMILY'),
          sale('s7', '7 MILL CREEK CT', 199000, 'TOWNHOUSE'),
        ],
      ),
      pick(side, [5, 4, 6], [3]),
    ),
  );

  const road = (id: string, location: string, work: string, restriction: string) =>
    rec({
      id,
      type: 'road-work',
      title: location,
      url: 'https://discover.example.gov/roads.pdf',
      raw: {
        LOCATION: location,
        DESCRIPTION: work,
        RESTRICTION: restriction,
        from: 'October 19, 2026',
        to: 'October 25, 2026',
      },
    });
  check('roadWorkRoundup', (t, side) =>
    roadWorkRoundup(
      t,
      week,
      pick(
        side,
        [
          road(
            'r1',
            'Ocean Blvd. at Harbor Walk',
            'Seawall repair.',
            'Southbound lane closed 9 a.m. to 3 p.m. RW1234',
          ),
          road(
            'r2',
            'Ocean Blvd. from 4th Street to Sea Grape Lane',
            'Repaving.',
            'Road closed with a detour via A1A.',
          ),
          road(
            'r3',
            'Dock Street approximately 200 feet east of Bay Drive',
            'FPL pole removal.',
            'Periodic right lane closure. UT55559-0626',
          ),
        ],
        [
          road(
            'r4',
            'Main Street at Mill Creek Road',
            'Water main replacement.',
            'Periodic eastbound lane closures at night.',
          ),
          road(
            'r5',
            'N. Pine Avenue from Oak Ridge Road to County Road 9',
            'Sidewalk installation.',
            'Periodic northbound right lane closure.',
          ),
        ],
      ),
      pick(side, [2, 4], [1, 1, 0]),
    ),
  );

  it('roadWorkRoundup leads with closures and drops permit numbers', () => {
    const d = roadWorkRoundup(harbor, week, [
      road(
        'r1',
        'Dock Street at Bay Drive',
        'Utility work.',
        'Periodic right lane closure. UT55559-0626',
      ),
      road(
        'r2',
        'Ocean Blvd. at Harbor Walk',
        'Seawall repair.',
        'Road closed with a detour via A1A.',
      ),
      road(
        'r3',
        'Ocean Blvd. from 4th Street to Sea Grape Lane',
        'Repaving.',
        'Lane closures. RW72642',
      ),
    ]);
    expect(d.headline).toBe('Road work and lane closures in Harbor Point, Oct. 19–Oct. 25');
    expect(d.dek).toMatch(
      /^3 road projects in Harbor Point, 1 with a road closed or detoured; Ocean Boulevard has the most, 2\.$/,
    );
    expect(d.bodyMd.split('\n').find((l) => l.startsWith('- '))).toContain(
      'Ocean Blvd. at Harbor Walk',
    );
    expect(d.bodyMd).not.toMatch(/UT55559|RW72642/);
    expect(d.beat).toBe('development');
    expect(d.sourceRecordIds).toEqual(['r1', 'r2', 'r3']);
  });

  check('weatherAlert', (t, side) =>
    weatherAlert(
      t,
      rec({
        id: 'w',
        type: 'alert',
        url: 'https://api.weather.gov/alerts/x',
        raw: pick(
          side,
          {
            event: 'Rip Current Statement',
            headline: 'Rip Current Statement issued October 15 by NWS Miami FL',
            areaDesc: 'Coastal Harbor Point',
            severity: 'Moderate',
            description:
              'Dangerous rip currents expected through Friday evening along Atlantic beaches.',
            instruction: 'Swim near a lifeguard. If caught in a rip current, relax and float.',
          },
          {
            event: 'Tornado Watch',
            headline: 'Tornado Watch issued October 15 by NWS Mobile AL',
            areaDesc: 'Inland Escambia; Santa Rosa',
            severity: 'Severe',
            description:
              'Conditions are favorable for tornadoes in and close to the watch area until 9 p.m.',
            instruction: 'Review your safety plan and be ready to move to a sturdy shelter.',
          },
        ),
      }),
    ),
  );
});
