import { fileURLToPath } from 'node:url';
import { NEAR_DUP_MAX } from '@towncore/config';
import { Fetcher, replayFetch, usaspendingAdapter } from '@towncore/adapters';
import { describe, expect, it } from 'vitest';
import { nearDuplicateShare } from '../src/near-duplicate';
import { federalAwardRows, federalAwardsRoundup, type TemplateRecord } from '../src/templates';

// The weekly federal awards roundup (USASpending, every town), built from the adapter's own
// recording of Boca Raton's awards (Sept. 17 to Oct. 17, 2026).
const fixture = fileURLToPath(
  new URL('../../adapters/fixtures/usaspending/boca-raton.json', import.meta.url),
);
const boca = { name: 'Boca Raton', timezone: 'America/New_York', agency: 'City of Boca Raton' };
const pine = { name: 'Pine Hollow', timezone: 'America/Chicago', agency: 'Town of Pine Hollow' };
const week = new Date('2026-09-21T04:00:00Z');

async function bocaAwards(): Promise<TemplateRecord[]> {
  const fetcher = new Fetcher({
    fetchImpl: replayFetch(fixture),
    sleep: async () => {},
    now: () => 0,
    minIntervalMs: 0,
  });
  const raw = await usaspendingAdapter.fetch(
    {
      id: 's',
      townId: 't',
      kind: 'federal_awards',
      platform: 'usaspending',
      url: null,
      config: { city: 'Boca Raton', state: 'FL' },
    },
    new Date('2026-10-01T00:00:00Z'),
    { fetcher, now: new Date('2026-10-17T12:00:00Z') },
  );
  return raw.map((r, i) => ({
    id: `r${i}`,
    type: r.type,
    title: r.title ?? null,
    text: r.text ?? null,
    url: r.url ?? null,
    occurredAt: r.occurredAt ?? null,
    raw: r.raw,
  }));
}

const award = (
  id: string,
  recipient: string,
  amount: number,
  agency: string,
  what: string,
  kind = 'contract',
) => ({
  id,
  type: 'federal-award',
  title: recipient,
  text: `Recipient: ${recipient}\nAward type: ${kind}\nAmount: ${amount}\nAwarded: 2026-09-23\nAgency: ${agency}\nDescription: ${what}`,
  url: `https://www.usaspending.gov/award/${id}`,
  occurredAt: new Date('2026-09-23T00:00:00Z'),
  raw: {},
});

describe('federal awards roundup', () => {
  it('leads with the largest award to a named organization and lists every award', async () => {
    const awards = await bocaAwards();
    const d = federalAwardsRoundup(boca, week, awards, [12, 9]);
    const rows = federalAwardRows(awards);
    const top = rows.filter((r) => r.named).sort((a, b) => b.amount - a.amount)[0]!;
    expect(d.headline).toMatch(
      /^.+ gets \$[\d,]+ federal (contract|grant), the largest of \d+ awards to recipients with a Boca Raton address$/,
    );
    expect(d.headline.toUpperCase()).toContain(top.recipient.split(' ')[0]!);
    expect(d.bodyMd).toMatch(
      /^Federal agencies made \d+ contracts? and \d+ grants? worth \$[\d,]+ in all/,
    );
    expect(d.bodyMd).toContain('## What stands out');
    expect(d.bodyMd).toContain('https://www.usaspending.gov/award/');
    expect(d.sourceRecordIds).toHaveLength(rows.length);
    expect(d.beat).toBe('business');
  });

  it('never names a recipient that may be a person', () => {
    const d = federalAwardsRoundup(boca, week, [
      award(
        'a',
        'DIOXIDE MATERIALS, INC.',
        5939747,
        'Department of Energy',
        'ELECTROCHEMICAL CO2 CONVERSION',
      ),
      award(
        'b',
        'JANE Q SAMPLE',
        120000,
        'Small Business Administration',
        'DISASTER LOAN',
        'grant',
      ),
    ]);
    expect(d.bodyMd).not.toMatch(/JANE|Sample/i);
    expect(d.bodyMd).toContain('Not named (may be a person)');
    expect(d.headline).toContain('Dioxide Materials, INC.');
  });

  it('reads differently in two towns', async () => {
    const a = federalAwardsRoundup(boca, week, (await bocaAwards()).slice(0, 8), [5]);
    const b = federalAwardsRoundup(pine, week, [
      award(
        'p1',
        'PINE HOLLOW SCHOOL DISTRICT',
        1200000,
        'Department of Education',
        'TITLE I SUPPORT FOR ELEMENTARY READING',
        'grant',
      ),
      award(
        'p2',
        'RIDGE MACHINE WORKS LLC',
        640000,
        'Department of Defense',
        'MACHINED PARTS FOR ARMY VEHICLE AXLES',
      ),
      award(
        'p3',
        'HOLLOW COUNTY',
        310000,
        'Department of Transportation',
        'RURAL BRIDGE INSPECTION PROGRAM',
        'grant',
      ),
    ]);
    const share = nearDuplicateShare(
      { text: `${a.dek}\n\n${a.bodyMd}`, names: [boca.name, boca.agency] },
      { text: `${b.dek}\n\n${b.bodyMd}`, names: [pine.name, pine.agency] },
    );
    expect(share).toBeLessThanOrEqual(NEAR_DUP_MAX);
  });
});
