import { describe, expect, it } from 'vitest';
import { buildByline } from '../src/byline';

describe('buildByline', () => {
  it('formats the newsroom byline', () => {
    expect(buildByline('Boca Town Square')).toBe('Boca Town Square Newsroom');
    expect(buildByline(' Boca Town Square ')).toBe('Boca Town Square Newsroom');
  });

  it('says a person reviewed it, without naming them', () => {
    expect(buildByline('Boca Town Square', true)).toBe(
      'Boca Town Square Newsroom. Reviewed by an editor',
    );
  });

  it('always satisfies the database byline check', () => {
    for (const byline of [buildByline('X'), buildByline('X', true)]) {
      expect(byline).toMatch(/ Newsroom/);
    }
  });
});
