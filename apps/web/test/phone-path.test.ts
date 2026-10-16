import { describe, expect, it } from 'vitest';
import { backTarget } from '../src/components/phone/path';

describe('phone back button', () => {
  it('has none on tab roots, Places included', () => {
    for (const path of ['/', '/sections', '/events', '/directory', '/search'])
      expect(backTarget(path)).toBeNull();
  });

  it('goes from a business to its category, and from a category to Places', () => {
    expect(backTarget('/directory/plumbers/cove-plumbing-test0003')).toEqual({
      href: '/directory/plumbers',
      label: 'Back',
    });
    expect(backTarget('/directory/plumbers')).toEqual({ href: '/directory', label: 'Places' });
    expect(backTarget('/directory/claim/cove-plumbing-test0003')).toEqual({
      href: '/directory',
      label: 'Places',
    });
    expect(backTarget('/owner')).toEqual({ href: '/directory', label: 'Places' });
    expect(backTarget('/owner/cove-plumbing-test0003')).toEqual({ href: '/owner', label: 'Back' });
    expect(backTarget('/beat/government')).toEqual({ href: '/sections', label: 'Sections' });
    expect(backTarget('/news/a-story')).toEqual({ href: '/', label: 'Today' });
  });
});
