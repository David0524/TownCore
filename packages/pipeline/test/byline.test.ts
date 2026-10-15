import { describe, expect, it } from 'vitest';
import { buildByline } from '../src/byline';

describe('buildByline', () => {
  it('formats the AI-assisted newsroom byline', () => {
    expect(buildByline('Boca Town Square')).toBe('Boca Town Square Newsroom (AI-assisted)');
  });

  it('adds the human reviewer when there is one', () => {
    expect(buildByline('Boca Town Square', 'Jane Editor')).toBe(
      'Boca Town Square Newsroom (AI-assisted). Reviewed by Jane Editor',
    );
  });

  it('ignores blank reviewer names and trims input', () => {
    expect(buildByline(' Boca Town Square ', '  ')).toBe('Boca Town Square Newsroom (AI-assisted)');
    expect(buildByline('Boca Town Square', null)).toBe('Boca Town Square Newsroom (AI-assisted)');
  });

  it('always satisfies the database byline check', () => {
    for (const byline of [buildByline('X'), buildByline('X', 'Y')]) {
      expect(byline).toMatch(/ Newsroom \(AI-assisted\)/);
    }
  });
});
