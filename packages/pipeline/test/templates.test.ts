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
  weatherAlert,
  type TemplateRecord,
} from '../src/templates';

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
  it('lists each meeting in time order with its When/Where text and link', () => {
    const draft = meetingsRoundup(town, week, [
      rec({
        id: 'b',
        title: 'City Council Regular Meeting',
        text: 'When: Tuesday, Oct. 27, 2026, 6 p.m.\nWhere: City Hall',
        url: 'https://www.myboca.us/Calendar.aspx?EID=2',
        occurredAt: new Date('2026-10-27T22:00:00Z'),
      }),
      rec({
        id: 'a',
        title: 'Planning & Zoning Board',
        text: 'When: Monday, Oct. 19, 2026, 6 p.m.',
        occurredAt: new Date('2026-10-19T22:00:00Z'),
      }),
    ]);
    expect(draft.headline).toBe('Public meetings in Boca Raton, Oct. 19–Oct. 25');
    expect(draft.sourceRecordIds).toEqual(['b', 'a']);
    const items = draft.bodyMd.split('\n').filter((l) => l.startsWith('- '));
    expect(items).toEqual([
      '- **Planning & Zoning Board**: Monday, Oct. 19, 2026, 6 p.m.',
      '- **City Council Regular Meeting**: Tuesday, Oct. 27, 2026, 6 p.m.; City Hall. [Agenda and details](https://www.myboca.us/Calendar.aspx?EID=2)',
    ]);
  });
});

describe('newBusinessesRoundup', () => {
  it('lists filings by name with type, date and ZIP only (never a street address)', () => {
    const draft = newBusinessesRoundup(town, new Date('2026-10-05T04:00:00Z'), [
      rec({
        id: 'f2',
        type: 'new-filing',
        title: 'ZETA *SERVICES* LLC',
        text: 'Florida limited liability company, document number L26000001, filed 10/06/2026. Principal address: 100 Main St, BOCA RATON, FL 33431-1234. Status: active.',
        raw: { zip: '33431-1234' },
      }),
      rec({
        id: 'f1',
        type: 'new-filing',
        title: 'ALPHA CORP',
        text: 'Florida profit corporation, document number P26000002, filed 10/07/2026. Principal address: 9 Elm Rd, BOCA RATON, FL 33432.',
        raw: { zip: '33432' },
      }),
    ]);
    expect(draft.bodyMd).toContain(
      'recorded 2 new business filings with a Boca Raton mailing address',
    );
    // State records give a mailing city, which can be outside city limits (wrong-town risk).
    expect(draft.bodyMd).toContain('can be outside the city limits');
    expect(draft.headline).not.toMatch(/ in Boca Raton/);
    expect(draft.bodyMd).toContain(
      '- **ALPHA CORP**: Florida profit corporation, filed 10/07/2026, ZIP 33432\n- **ZETA \\*SERVICES\\* LLC**: Florida limited liability company, filed 10/06/2026, ZIP 33431',
    );
    expect(draft.bodyMd).not.toMatch(/Main St|Elm Rd/);
    expect(draft.beat).toBe('business');
  });
});

describe('newLicensesRoundup', () => {
  it('uses the business name when there is one', () => {
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
    expect(draft.bodyMd).toContain(
      '- **DOE ROOFING LLC**: Certified Roofing Contractor, license CCC1234567',
    );
    expect(draft.dek).toContain('issued 1 new license');
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

  it('groups visits by outcome, names closures and complaints with counts, and cites every record', () => {
    const draft = inspectionsRoundup(town, week, rows);
    expect(draft.headline).toBe(
      'Restaurant inspections with a Boca Raton address, Oct. 19–Oct. 25',
    );
    expect(draft.dek).toBe(
      'State inspectors visited 4 food service establishments; 1 ordered closed and 1 with an administrative complaint recommended.',
    );
    expect(draft.bodyMd).toContain('## Ordered closed');
    expect(draft.bodyMd).toContain(
      '- **Zed Diner**: 1 Main St; inspected 10/20/2026; 14 violations, 6 high priority.',
    );
    expect(draft.bodyMd).toContain('inspected 10/21/2026 (call-back visit)');
    expect(draft.bodyMd).toContain('## Warnings and follow-ups');
    expect(draft.bodyMd).toContain('1 establishment needed no further action');
    // Two visits to one place count once.
    expect(draft.bodyMd.match(/Gamma Grill/g)).toHaveLength(1);
    expect(draft.bodyMd).toMatch(/snapshot of conditions/);
    expect(draft.sourceRecordIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(draft.beat).toBe('business');
  });

  it('flags weeks that name failures for review', () => {
    expect(hasInspectionFailures(rows.map((r) => r.raw))).toBe(true);
    expect(hasInspectionFailures(rows.slice(2).map((r) => r.raw))).toBe(false);
    const clean = inspectionsRoundup(town, week, rows.slice(3));
    expect(clean.dek).toBe('State inspectors visited 1 food service establishment.');
    expect(clean.bodyMd).not.toContain('## Ordered closed');
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
    expect(draft.bodyMd).toContain(
      '- **Delta Deli**: inspected 10/20/2026; 6 violations, 2 high priority; a call-back visit on 10/21/2026 found it in compliance.',
    );
    expect(draft.bodyMd).not.toContain('## Met inspection standards');
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

  it('lists permits by estimated cost with contractor and link, then counts by type', () => {
    const draft = permitsRoundup(town, week, rows);
    expect(draft.headline).toBe('Building permits in Boca Raton, Oct. 19–Oct. 25');
    expect(draft.dek).toBe(
      '3 permits with a combined estimated cost of $251,000, according to the official permit records.',
    );
    const list = draft.bodyMd.split('## All permits')[1]!;
    expect(list.indexOf('12 NE 4 Ave')).toBeLessThan(list.indexOf('5641 Raleigh St'));
    expect(draft.bodyMd).toContain(
      '- **Building Permit: New at 5641 Raleigh St**: estimated cost $1,000; contractor Mtci Private Provider Services LLC. [Record](https://data.x.gov/d/p1)',
    );
    expect(draft.bodyMd).toContain('- **Demolition Permit at 724 Palm Dr** [Record]');
    expect(draft.bodyMd).toContain('## By type\n\n- Building Permit: 2\n- Demolition Permit: 1');
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

  it('lists the highest prices with the median and counts by kind, with no names', () => {
    const draft = propertySalesRoundup(town, week, [
      sale('a', '6760 WILLOW WOOD DR 1201', 700000, 'CONDOMINIUM', '2026-10-20'),
      sale('b', '1200 S OCEAN BLVD', 12500000, 'SINGLE FAMILY', '2026-10-21'),
      sale('c', '22 NE 5TH AVE', 450000, 'CONDOMINIUM', '2026-10-22'),
    ]);
    expect(draft.headline).toBe('Property sales in Boca Raton, Oct. 19–Oct. 25');
    expect(draft.dek).toBe(
      '3 sales recorded, with a median price of $700,000, according to county property records.',
    );
    expect(draft.beat).toBe('development');
    const items = draft.bodyMd.split('\n').filter((l) => l.startsWith('- **'));
    expect(items).toEqual([
      '- **1200 S Ocean Blvd**: $12,500,000, single family, Oct. 21. [Record](https://maps.example.gov/MapServer/1)',
      '- **6760 Willow Wood Dr 1201**: $700,000, condominium, Oct. 20. [Record](https://maps.example.gov/MapServer/1)',
      '- **22 NE 5th Ave**: $450,000, condominium, Oct. 22. [Record](https://maps.example.gov/MapServer/1)',
    ]);
    expect(draft.bodyMd).toContain(
      '## By kind of property\n\n- Condominium: 2\n- Single Family: 1',
    );
    expect(draft.sourceRecordIds).toEqual(['a', 'b', 'c']);
  });
});
