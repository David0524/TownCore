import { describe, expect, it } from 'vitest';
import { sunTimes, townSunset } from '../src/lib/sun';

const minutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

describe('sunset', () => {
  it('matches published times within two minutes', () => {
    // London, June 21 2024: sunrise 04:43 BST (03:43 UTC), sunset 21:21 BST (20:21 UTC).
    const london = sunTimes(new Date('2024-06-21T12:00:00Z'), 51.5074, -0.1278)!;
    expect(Math.abs(minutes(london.sunrise) - (3 * 60 + 43))).toBeLessThanOrEqual(2);
    expect(Math.abs(minutes(london.sunset) - (20 * 60 + 21))).toBeLessThanOrEqual(2);
  });

  it("gives Boca's sunset on its local date (after midnight UTC)", () => {
    // Boca Raton, Oct. 15 2026: sunset around 6:50 p.m. EDT (22:50 UTC).
    const sunset = townSunset(
      new Date('2026-10-15T16:00:00Z'),
      'America/New_York',
      26.3587,
      -80.0831,
    )!;
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    }).format(sunset);
    expect(local).toMatch(/^6:(4[5-9]|5\d) PM$/);
  });

  it('returns null in polar night', () => {
    expect(sunTimes(new Date('2024-12-21T12:00:00Z'), 78.2, 15.6)).toBeNull();
  });
});
