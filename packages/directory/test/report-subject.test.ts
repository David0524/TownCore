import { describe, expect, it } from 'vitest';
import { reportSubject } from '../src/reports';

// The proof report's subject line is the `proof-report-wording` experiment (owner, 2026-10-17).

describe('reportSubject', () => {
  const totals = { listingViews: 1200, cardImpressions: 34 };
  it('names the month in the control', () => {
    expect(reportSubject('control', 'Shop', 'The Ledger', 'September 2026', totals)).toBe(
      'Shop on The Ledger: your September 2026 report',
    );
  });
  it('leads with the views in people-saw, and falls back when there were none', () => {
    expect(reportSubject('people-saw', 'Shop', 'The Ledger', 'September 2026', totals)).toBe(
      '1,234 views of Shop on The Ledger in September 2026',
    );
    expect(
      reportSubject('people-saw', 'Shop', 'The Ledger', 'September 2026', {
        listingViews: 0,
        cardImpressions: 0,
      }),
    ).toBe('Shop on The Ledger: your September 2026 report');
  });
});
