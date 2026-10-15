import { describe, expect, it } from 'vitest';
import {
  isIssuedLicense,
  isNewsworthyAlert,
  meetingsRoundup,
  newBusinessesRoundup,
  newLicensesRoundup,
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
