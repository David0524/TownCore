import { describe, expect, it } from 'vitest';
import {
  assignVariant,
  classifyReferral,
  EXPERIMENTS,
  placementOf,
  resolveVariant,
  signupSource,
  type ExperimentKey,
} from '../src/audience';

// Audience and experiments (owner, 2026-10-17): referral classes worked out in the browser,
// sign-up placements, and per-town experiment assignment.

const page = { pageHost: 'harborpoint.test', search: '' };

describe('classifyReferral', () => {
  it('sorts referrers into classes, never keeping the URL', () => {
    const cls = (referrer: string, search = '') => classifyReferral({ ...page, referrer, search });
    expect(cls('')).toBe('direct');
    expect(cls('https://www.google.com/')).toBe('search');
    expect(cls('https://www.bing.com/search?q=x')).toBe('search');
    expect(cls('https://duckduckgo.com/')).toBe('search');
    expect(cls('https://m.facebook.com/')).toBe('facebook');
    expect(cls('https://l.facebook.com/l.php?u=x')).toBe('facebook');
    expect(cls('https://lm.instagram.com/')).toBe('facebook');
    expect(cls('https://t.co/abc')).toBe('social');
    expect(cls('https://www.reddit.com/r/x')).toBe('social');
    expect(cls('https://harborpoint.test/news/a')).toBe('internal');
    expect(cls('https://example.org/')).toBe('other');
    expect(cls('not a url')).toBe('other');
    // The newsletter's ?ref= wins over whatever the mail client sends.
    expect(cls('https://mail.google.com/', '?ref=newsletter')).toBe('newsletter');
    expect(cls('', '?a=1&ref=newsletter')).toBe('newsletter');
    expect(cls('', '?ref=newsletters')).toBe('direct');
  });
});

describe('sign-up placements', () => {
  it('round-trips a placement through the subscriber source', () => {
    expect(signupSource('second-article')).toBe('signup_form:second-article');
    expect(signupSource(null)).toBe('signup_form');
    expect(placementOf('signup_form:article')).toBe('article');
    expect(placementOf('signup_form')).toBeNull();
    expect(placementOf('signup_form:popup')).toBeNull();
    expect(placementOf('import')).toBeNull();
    expect(placementOf(null)).toBeNull();
  });
});

describe('experiments', () => {
  const town = { id: '6f1c2c4e-0000-4000-8000-000000000001', cohort: '2027-01' };
  const keys = Object.keys(EXPERIMENTS) as ExperimentKey[];

  it('assigns the same variant to the same unit every time, and spreads units across variants', () => {
    for (const key of keys) {
      expect(assignVariant(key, town.id)).toBe(assignVariant(key, town.id));
      const seen = new Set(Array.from({ length: 40 }, (_, i) => assignVariant(key, `town-${i}`)));
      expect([...seen].sort()).toEqual([...EXPERIMENTS[key].variants].sort());
    }
  });

  it('shows the control while off, the recorded variant while running, the winner once decided', () => {
    expect(resolveVariant('signup-prompt', null, town)).toBe('control');
    expect(
      resolveVariant('signup-prompt', { status: 'off', unit: 'town', winner: null }, town),
    ).toBe('control');
    const running = { status: 'running', unit: 'town', winner: null } as const;
    expect(resolveVariant('signup-prompt', running, town, 'local-news')).toBe('local-news');
    // A recorded value that isn't a variant falls back to the hash.
    expect(resolveVariant('signup-prompt', running, town, 'bogus')).toBe(
      assignVariant('signup-prompt', town.id),
    );
    // By cohort: every town in a cohort gets the same variant.
    const byCohort = { status: 'running', unit: 'cohort', winner: null } as const;
    expect(resolveVariant('module-order', byCohort, town)).toBe(
      resolveVariant('module-order', byCohort, { id: 'other-town', cohort: '2027-01' }),
    );
    expect(
      resolveVariant(
        'module-order',
        { status: 'decided', unit: 'town', winner: 'signup-first' },
        town,
      ),
    ).toBe('signup-first');
    expect(
      resolveVariant('module-order', { status: 'decided', unit: 'town', winner: 'gone' }, town),
    ).toBe('control');
  });

  it('starts every experiment on its control', () => {
    expect(EXPERIMENTS['second-article-offer'].variants[0]).toBe('on');
    for (const key of keys.filter((k) => k !== 'second-article-offer'))
      expect(EXPERIMENTS[key].variants[0]).toBe('control');
  });
});
