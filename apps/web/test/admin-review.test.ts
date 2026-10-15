import { describe, expect, it } from 'vitest';
import { minorOverridable } from '../src/lib/admin/review';

describe('minorOverridable (CLAUDE.md §7: minor flag is the only Tier 4 override)', () => {
  it('allows the override only when every Tier 4 reason is a minor flag', () => {
    expect(minorOverridable({ tier: 4, tierReasons: ['possible minor: "teens" mentioned'] })).toBe(
      true,
    );
    expect(minorOverridable({ tier: 4, tierReasons: ['names a minor (A B)'] })).toBe(true);
    expect(
      minorOverridable({
        tier: 4,
        tierReasons: ['names a minor (A B)', 'arrest without an official release'],
      }),
    ).toBe(false);
    expect(
      minorOverridable({ tier: 4, tierReasons: ['rumor or a private person’s social post'] }),
    ).toBe(false);
    expect(minorOverridable({ tier: 3, tierReasons: ['names a minor (A B)'] })).toBe(false);
  });
});
