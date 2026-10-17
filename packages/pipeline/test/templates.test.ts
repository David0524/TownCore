import { describe, expect, it } from 'vitest';
import {
  hasInspectionFailures,
  inspectionsRoundup,
  isIssuedLicense,
  isNewsworthyAlert,
  meetingsRoundup,
  newBusinessesRoundup,
  newLicensesRoundup,
  permitsRoundup,
  propertySalesRoundup,
  newPlacesRoundup,
  dataTable,
  nameKind,
  roundupBody,
  SHOWN_ROWS,
  weatherAlert,
  weekTrend,
  type TemplateRecord,
} from '../src/templates';

/** The rows of the first pipe table in a body, without its header and divider. */
const tableRows = (body: string) =>
  body
    .split('\n')
    .filter((l) => l.startsWith('| '))
    .slice(2);

const town = { name: 'Boca Raton', timezone: 'America/New_York', agency: 'City of Boca Raton' };
const week = new Date('2026-10-19T04:00:00Z');

const rec = (over: Partial<TemplateRecord>): TemplateRecord => ({
  id: 'r1',
  type: 'meeting',
  title: null,
  text: null,
  url: null,
  occurredAt: null,
  raw: {},
  ...over,
});

describe('meetingsRoundup', () => {
  it('leads with the governing body and lists each meeting in time order with its link', () => {
    const draft = meetingsRoundup(town, week, [
      rec({
        id: 'b',
        title: 'City Council Regular Meeting',
        text: 'When: Tuesday, Oct. 20, 2026, 6 p.m.\nWhere: City Hall',
        url: 'https://www.myboca.us/Calendar.aspx?EID=2',
        occurredAt: new Date('2026-10-20T22:00:00Z'),
      }),
      rec({
        id: 'a',
        title: 'Planning & Zoning Board',
        text: 'When: Monday, Oct. 19, 2026, 6 p.m.',
        occurredAt: new Date('2026-10-19T22:00:00Z'),
      }),
    ]);
    expect(draft.headline).toBe(
      'City Council meets Tuesday, Oct. 20, one of 2 public meetings in Boca Raton',
    );
    expect(draft.dek).toBe('2 public meetings on the City of Boca Raton calendar, Oct. 19–25.');
    expect(draft.bodyMd).toMatch(
      /^City Council meets Tuesday, Oct\. 20, 2026, 6 p\.m\. at City Hall\./,
    );
    expect(draft.sourceRecordIds).toEqual(['b', 'a']);
    // A thin week: no highlights section, just the list.
    expect(draft.bodyMd).not.toContain('## What stands out');
    const items = draft.bodyMd.split('\n').filter((l) => l.startsWith('- '));
    expect(items).toEqual([
      '- **Planning & Zoning Board**: Monday, Oct. 19, 2026, 6 p.m.',
      '- **City Council Regular Meeting**: Tuesday, Oct. 20, 2026, 6 p.m.; City Hall. [Agenda and details](https://www.myboca.us/Calendar.aspx?EID=2)',
    ]);
  });
});

describe('newBusinessesRoundup', () => {
  const filing = (
    id: string,
    name: string,
    kind: string,
    day: string,
    zip: string,
    street = '1 Main St',
  ) =>
    rec({
      id,
      type: 'new-filing',
      title: name,
      text: `${kind}, document number ${id}, filed 10/${day}/2026. Principal address: ${street}, BOCA RATON, FL ${zip}.`,
      raw: { zip, address1: street },
    });

  it('keeps a thin week short: a lede and the data, ZIP codes only, never a street address', () => {
    const draft = newBusinessesRoundup(town, new Date('2026-10-05T04:00:00Z'), [
      filing('f2', 'ZETA *SERVICES* LLC', 'Florida limited liability company', '06', '33431-1234'),
      filing('f1', 'ALPHA CORP', 'Florida profit corporation', '07', '33432', '9 Elm Rd'),
    ]);
    expect(draft.headline).toBe(
      'Alpha Corp and Zeta *services* LLC registered with a Boca Raton address',
    );
    expect(draft.headline).not.toMatch(/ in Boca Raton/);
    expect(draft.dek).toBe(
      '2 new businesses filed with the state with a Boca Raton mailing address, Oct. 5–11.',
    );
    expect(draft.bodyMd).toMatch(/^By filing type: 1 corporation and 1 LLC\./);
    expect(draft.bodyMd).not.toContain('## What stands out');
    expect(tableRows(draft.bodyMd)).toEqual([
      '| Alpha Corp | corporation | 33432 | Oct. 7 |',
      '| Zeta \\*services\\* LLC | LLC | 33431 | Oct. 6 |',
    ]);
    expect(draft.bodyMd).not.toMatch(/Main St|Elm Rd/);
    expect(draft.beat).toBe('business');
  });

  it('reads like an article on a full week: places to visit lead, highlights, a collapsed table', () => {
    const names = [
      'SEASIDE BREWING COMPANY LLC',
      'BOCA SMILES DENTAL PA',
      'GLADES DENTAL GROUP LLC',
      'SUNRISE NAIL SPA LLC',
      'ATLANTIC HOLDINGS LLC',
      'MIZNER CAPITAL LLC',
      'FRIENDS OF THE LIBRARY INC',
    ];
    const filings = Array.from({ length: 40 }, (_, i) =>
      filing(
        `n${i}`,
        names[i] ?? `SAMPLE ${String(i).padStart(2, '0')} LLC`,
        i === 6
          ? 'Florida not for profit corporation'
          : i % 5 === 0
            ? 'Foreign limited liability company'
            : 'Florida limited liability company',
        `0${5 + (i % 5)}`,
        i % 3 ? '33431' : '33432',
        i % 4 ? `${100 + i} Glades Rd Ste 2` : `${i} Elm St`,
      ),
    );
    const draft = newBusinessesRoundup(
      town,
      new Date('2026-10-05T04:00:00Z'),
      filings,
      [32, 30, 35],
    );
    expect(draft.headline).toBe(
      'A brewery, two dental practices and 37 other businesses registered with a Boca Raton address',
    );
    const [lede] = draft.bodyMd.split('\n\n');
    expect(lede).toContain("That's up from 32 the week before, and the most in 4 weeks.");
    expect(lede).toContain('Among them by name: a brewery (Seaside Brewing Company LLC)');
    const highlights = draft.bodyMd
      .split('## What stands out\n\n')[1]!
      .split('\n\n')[0]!
      .split('\n');
    expect(highlights.length).toBeGreaterThanOrEqual(2);
    expect(highlights.length).toBeLessThanOrEqual(5);
    // Ranked: places people can visit beyond the headline's, then street clusters.
    expect(highlights[0]).toBe('- Also by name: a salon or spa (Sunrise Nail Spa LLC).');
    expect(highlights[1]).toMatch(/^- 30 list an address on Glades Rd\.$/);
    // The table shows a dozen rows, then the rest inside a closed "Show all".
    expect(draft.bodyMd).toContain('## All 40 filings');
    const [shown, rest] = draft.bodyMd.split(':::details Show all 40 filings');
    expect(tableRows(shown!.split('## All 40 filings')[1]!)).toHaveLength(SHOWN_ROWS);
    expect(tableRows(rest!.split('\n:::')[0]!)).toHaveLength(40 - SHOWN_ROWS);
    // Lede and highlights come before any table.
    expect(draft.bodyMd.indexOf('## What stands out')).toBeLessThan(draft.bodyMd.indexOf('| '));
    expect(draft.bodyMd).toContain('[the directory](/directory/restaurants)');
    expect(draft.bodyMd).not.toMatch(/\d+ Glades Rd|\d+ Elm St/);
    expect(draft.bodyMd).not.toMatch(/booming|exciting/i);
    expect(draft.sourceRecordIds).toHaveLength(40);
  });
});

describe('newLicensesRoundup', () => {
  it('uses the business name when there is one and leads with the trade', () => {
    const draft = newLicensesRoundup(town, week, [
      rec({
        id: 'l1',
        type: 'license',
        raw: {
          licenseeName: 'DOE, PAT',
          dbaName: 'DOE ROOFING LLC',
          occupation: 'Certified Roofing Contractor',
          alternateLicenseNumber: 'CCC1234567',
        },
      }),
    ]);
    expect(draft.headline).toBe(
      'A certified roofing contractor licensed with a Boca Raton address',
    );
    expect(tableRows(draft.bodyMd)).toEqual([
      '| DOE ROOFING LLC | Certified Roofing Contractor | CCC1234567 |',
    ]);
    expect(draft.dek).toBe(
      '1 first state license for contractors with a Boca Raton mailing address, Oct. 19–25.',
    );
    expect(draft.bodyMd).toContain('[roofers](/directory/roofers)');
  });
});

describe('isIssuedLicense', () => {
  it('rejects DBPR business-information rows, which carry no license number', () => {
    expect(isIssuedLicense({ alternateLicenseNumber: 'CGC1542084' })).toBe(true);
    expect(isIssuedLicense({ licenseNumber: '1542084' })).toBe(true);
    expect(
      isIssuedLicense({
        occupation: 'Construction Business Information',
        occupationCode: 'QB',
        licenseNumber: '',
        alternateLicenseNumber: '',
      }),
    ).toBe(false);
    expect(isIssuedLicense(null)).toBe(false);
  });
});

describe('weather alerts', () => {
  const alert = {
    event: 'Flood Watch',
    headline: 'Flood Watch issued October 15 by NWS Miami FL',
    description:
      '* WHAT...Flooding caused by\nexcessive rainfall.\n\n* WHERE...Coastal Palm Beach.',
    instruction: 'Monitor later forecasts.',
    severity: 'Moderate',
    messageType: 'Alert',
    areaDesc: 'Coastal Palm Beach',
  };

  it('only moderate or worse alerts that are not cancellations', () => {
    expect(isNewsworthyAlert(alert)).toBe(true);
    expect(isNewsworthyAlert({ ...alert, severity: 'Minor' })).toBe(false);
    expect(isNewsworthyAlert({ ...alert, messageType: 'Cancel' })).toBe(false);
  });

  it('quotes the alert verbatim and attributes it', () => {
    const draft = weatherAlert(
      town,
      rec({ id: 'w', type: 'alert', raw: alert, url: 'https://alerts.weather.gov/x' }),
    );
    expect(draft.headline).toBe(
      'National Weather Service issues Flood Watch for the Boca Raton area',
    );
    expect(draft.bodyMd).toContain(
      '> \\* WHAT...Flooding caused by excessive rainfall.\n>\n> \\* WHERE...Coastal Palm Beach.',
    );
    expect(draft.bodyMd).toContain('> Monitor later forecasts.');
    expect(draft.sourceRecordIds).toEqual(['w']);
  });
});

describe('inspectionsRoundup', () => {
  const visit = (id: string, raw: Record<string, unknown>) =>
    rec({ id, type: 'inspection', title: String(raw.business), raw });
  const rows = [
    visit('a', {
      business: 'ZED DINER',
      address: '1 MAIN ST',
      date: '10/20/2026',
      total: 14,
      highPriority: 6,
      severity: 'closure',
      disposition: 'Emergency order recommended',
    }),
    visit('b', {
      business: 'ALPHA CAFE',
      address: '2 B ST',
      date: '10/21/2026',
      total: 9,
      highPriority: 3,
      severity: 'complaint',
      visit: 2,
    }),
    visit('c', {
      business: 'BETA BAGELS',
      address: '3 C ST',
      date: '10/22/2026',
      total: 4,
      highPriority: 0,
      severity: 'warning',
    }),
    visit('d', {
      licenseNumber: '4',
      business: 'GAMMA GRILL',
      date: '10/20/2026',
      total: 1,
      severity: 'ok',
    }),
    visit('e', {
      licenseNumber: '4',
      business: 'GAMMA GRILL',
      date: '10/22/2026',
      total: 0,
      severity: 'ok',
    }),
  ];

  it('leads with closures and complaints, lists each place once, and cites every record', () => {
    const draft = inspectionsRoundup(town, week, rows);
    expect(draft.headline).toBe(
      'Inspectors order Zed Diner closed; 4 places inspected with a Boca Raton address',
    );
    expect(draft.dek).toBe('State inspectors visited 4 food service establishments, Oct. 19–25.');
    expect(draft.bodyMd).toMatch(/^Inspectors ordered Zed Diner closed/);
    // Highlights: closure, then complaint, then warnings.
    const highlights = draft.bodyMd.split('## What stands out\n\n')[1]!.split('\n\n')[0]!;
    expect(highlights.split('\n')).toEqual([
      '- **Zed Diner**: 1 Main St; inspected 10/20/2026; 14 violations, 6 high priority.',
      '- **Alpha Cafe**: 2 B St; inspected 10/21/2026 (call-back visit); 9 violations, 3 high priority.',
      '- **Beta Bagels**: 3 C St; inspected 10/22/2026; 4 violations, 0 high priority.',
    ]);
    expect(tableRows(draft.bodyMd).map((r) => r.split(' | ')[1])).toEqual([
      'Ordered closed',
      'Complaint recommended',
      'Warning',
      'Met standards',
    ]);
    // Two visits to one place count once.
    expect(draft.bodyMd.match(/Gamma Grill/g)).toHaveLength(1);
    expect(draft.sourceRecordIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(draft.beat).toBe('business');
  });

  it('flags weeks that name failures for review', () => {
    expect(hasInspectionFailures(rows.map((r) => r.raw))).toBe(true);
    expect(hasInspectionFailures(rows.slice(2).map((r) => r.raw))).toBe(false);
    const clean = inspectionsRoundup(town, week, rows.slice(3));
    expect(clean.headline).toBe('Gamma Grill meets inspection standards with a Boca Raton address');
    expect(clean.dek).toBe('State inspectors visited 1 food service establishment, Oct. 19–25.');
    expect(clean.bodyMd).not.toContain('Ordered closed');
  });

  it('notes a same-week call-back that found the problems fixed', () => {
    const draft = inspectionsRoundup(town, week, [
      visit('x', {
        licenseNumber: '9',
        business: 'DELTA DELI',
        date: '10/20/2026',
        total: 6,
        highPriority: 2,
        severity: 'complaint',
      }),
      visit('y', {
        licenseNumber: '9',
        business: 'DELTA DELI',
        date: '10/21/2026',
        total: 0,
        visit: 2,
        severity: 'ok',
      }),
    ]);
    expect(tableRows(draft.bodyMd)).toEqual([
      '| Delta Deli | Complaint recommended; in compliance 10/21/2026 | 10/20/2026 | 6 (2) |',
    ]);
    expect(draft.bodyMd).not.toContain('Met standards');
  });
});

describe('permitsRoundup', () => {
  const permit = (id: string, title: string, lines: string[]) =>
    rec({ id, type: 'permit', title, text: lines.join('\n'), url: `https://data.x.gov/d/${id}` });
  const rows = [
    permit('p1', 'Building Permit: New at 5641 RALEIGH ST', [
      'Type: Building Permit',
      'Estimated cost: 1000',
      'Contractor: MTCI PRIVATE PROVIDER SERVICES LLC',
    ]),
    permit('p2', 'Building Permit: Addition at 12 NE 4 AVE', [
      'Type: Building Permit',
      'Estimated cost: $250,000',
    ]),
    permit('p3', 'Demolition Permit at 724 PALM DR', ['Type: Demolition Permit']),
  ];

  it('leads with the biggest project, then every permit by estimated cost with its record link', () => {
    const draft = permitsRoundup(town, week, rows);
    expect(draft.headline).toBe(
      'Building Permit: Addition at 12 NE 4 Ave ($250,000) is the largest of 3 permits in Boca Raton',
    );
    expect(draft.dek).toBe('3 permits worth an estimated $251,000, Oct. 19–25.');
    const table = tableRows(draft.bodyMd);
    expect(table[0]).toContain(
      '[Building Permit: Addition at 12 NE 4 Ave](https://data.x.gov/d/p2)',
    );
    expect(table[1]).toBe(
      '| [Building Permit: New at 5641 Raleigh St](https://data.x.gov/d/p1) | Building Permit | $1,000 | Mtci Private Provider Services LLC |',
    );
    expect(table[2]).toContain('Demolition Permit at 724 Palm Dr');
    expect(draft.bodyMd).toContain('Building Permit permits led, 2 of 3.');
    expect(draft.beat).toBe('development');
    expect(draft.sourceRecordIds).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('propertySalesRoundup', () => {
  const sale = (id: string, address: string, price: number, use: string, day: string) =>
    rec({
      id,
      type: 'sale',
      title: address,
      text: `Address: ${address}\nPrice: ${price}\nSale date: ${day}\nDeed: WD\nUse: ${use}`,
      url: 'https://maps.example.gov/MapServer/1',
    });

  it('leads with the highest price, then the median and mix, with no names', () => {
    const draft = propertySalesRoundup(town, week, [
      sale('a', '6760 WILLOW WOOD DR 1201', 700000, 'CONDOMINIUM', '2026-10-20'),
      sale('b', '1200 S OCEAN BLVD', 12500000, 'SINGLE FAMILY', '2026-10-21'),
      sale('c', '22 NE 5TH AVE', 450000, 'CONDOMINIUM', '2026-10-22'),
    ]);
    expect(draft.headline).toBe(
      '1200 S Ocean Blvd sold for $12,500,000, the highest of 3 property sales in Boca Raton',
    );
    expect(draft.dek).toBe('3 sales recorded, Oct. 19–25.');
    expect(draft.beat).toBe('development');
    expect(tableRows(draft.bodyMd)).toEqual([
      '| [1200 S Ocean Blvd](https://maps.example.gov/MapServer/1) | $12,500,000 | single-family home | Oct. 21 |',
      '| [6760 Willow Wood Dr 1201](https://maps.example.gov/MapServer/1) | $700,000 | condominium | Oct. 20 |',
      '| [22 NE 5th Ave](https://maps.example.gov/MapServer/1) | $450,000 | condominium | Oct. 22 |',
    ]);
    expect(draft.bodyMd).toContain('median');
    expect(draft.bodyMd).not.toMatch(/Buyer|Seller/i);
    expect(draft.sourceRecordIds).toEqual(['a', 'b', 'c']);
  });
});

describe('newPlacesRoundup', () => {
  it('merges a place’s food and liquor licenses into one line and never names a person', () => {
    const draft = newPlacesRoundup(town, week, [
      rec({
        id: 'f1',
        type: 'new_food_license',
        raw: {
          businessName: 'MAISON BRUNCH',
          occupation: 'Permanent Food Service, seating',
          address1: '23064 SANDALFOOT PLAZA DRIVE',
        },
      }),
      rec({
        id: 'l1',
        type: 'liquor_license',
        raw: {
          business: 'MAISON BRUNCH',
          sells: 'beer and wine served on site',
          street: '23064 SANDALFOOT PLAZA DRIVE',
        },
      }),
      // A sole proprietor with no trade name, and a vending machine: neither is listed.
      rec({
        id: 'f2',
        type: 'new_food_license',
        raw: { licenseeName: 'JANE DOE', occupation: 'Permanent Food Service, non-seating' },
      }),
      rec({
        id: 'f3',
        type: 'new_food_license',
        raw: { businessName: 'SNACK BOX', occupation: 'Vending Machine', address1: '1 MAIN ST' },
      }),
    ]);
    expect(draft.headline).toBe(
      'Maison Brunch gets state approval to serve food or drink with a Boca Raton address',
    );
    expect(tableRows(draft.bodyMd)).toEqual([
      '| Maison Brunch | 23064 Sandalfoot Plaza Drive | new restaurant with seating; liquor license for beer and wine served on site |',
    ]);
    expect(draft.bodyMd).toContain('got both a food service license and a liquor license');
    expect(draft.bodyMd).toContain('[the directory](/directory/restaurants)');
    expect(draft.bodyMd).not.toContain('Jane');
    expect(draft.sourceRecordIds).toEqual(['f1', 'l1']);
  });
});

describe('weekTrend', () => {
  it("compares with the town's own past weeks, and says nothing without them", () => {
    expect(weekTrend(5, [])).toBeNull();
    expect(weekTrend(5, [3])).toContain('up from 3 the week before');
    expect(weekTrend(2, [3])).toContain('down from 3 the week before');
    expect(weekTrend(9, [3, 4, 5])).toContain('the most in 4 weeks');
  });
});

describe('the shared roundup layout', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [`Row ${i + 1}`, `${i}`]);

  it('shows short tables whole and collapses long ones after a dozen rows', () => {
    const short = dataTable({ head: ['Name', 'N'], rows: rows(15), noun: ['row', 'rows'] });
    expect(short).not.toContain(':::details');
    expect(tableRows(short)).toHaveLength(15);
    const long = dataTable({ head: ['Name', 'N'], rows: rows(101), noun: ['row', 'rows'] });
    expect(long).toContain(':::details Show all 101 rows');
    expect(long.trim().endsWith(':::')).toBe(true);
    // Every row stays in the text: 12 shown, 89 inside the closed block.
    expect(long.match(/\| Row \d+ \|/g)).toHaveLength(101);
  });

  it('never stretches a thin week: no highlights, no data heading', () => {
    const body = roundupBody({
      thin: true,
      lede: ['Three filings.', null],
      highlights: ['One.', 'Two.'],
      dataTitle: 'All 3 filings',
      data: '| a |\n| --- |\n| b |',
    });
    expect(body).toBe('Three filings.\n\n| a |\n| --- |\n| b |');
  });

  it('shows "What stands out" only with two or more highlights, at most five', () => {
    const one = roundupBody({ lede: ['Lede.'], highlights: ['Only one.'] });
    expect(one).not.toContain('What stands out');
    const many = roundupBody({ lede: ['Lede.'], highlights: ['1', '2', '3', '4', '5', '6', '7'] });
    expect(many.match(/^- /gm)).toHaveLength(5);
  });
});

describe('nameKind', () => {
  it('reads kinds of business from names, conservatively', () => {
    expect(nameKind('SEASIDE BREWING CO LLC')?.words[0]).toBe('brewery');
    expect(nameKind('SUNRISE NAIL SPA LLC')?.words[0]).toBe('salon or spa');
    // A pool and spa contractor isn't a spa.
    expect(nameKind('T.D. POOL AND SPA SERVICES LLC')?.words[0]).toBe('home services company');
    expect(nameKind('MARKETING PARTNERS LLC')?.words[0]).not.toBe('shop');
    expect(nameKind('ALEKSZ LLC')).toBeNull();
  });
});
