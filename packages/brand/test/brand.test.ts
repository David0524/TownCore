import { mastheadStyles, motifs } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { mastheadStyleNames, mastheadSvg } from '../src/masthead';
import { motifLibrary, motifSvg } from '../src/motifs';

describe('motif library', () => {
  it('has every motif the theme schema allows', () => {
    for (const name of motifs) expect(motifLibrary).toHaveProperty(name);
  });

  it('motifs are single-color (currentColor only, no fills or literal colors)', () => {
    for (const name of motifs) {
      const svg = motifSvg(name);
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    }
  });
});

describe('masthead', () => {
  it('supports every masthead style the theme schema allows', () => {
    expect([...mastheadStyleNames].sort()).toEqual([...mastheadStyles].sort());
  });

  it.each(mastheadStyleNames)('%s renders the site name as live, accessible text', (style) => {
    const svg = mastheadSvg({ siteName: 'Boca Town Square', style, motif: 'palm-frond' });
    expect(svg).toMatch(/^<svg [^>]*role="img"[^>]*aria-label="Boca Town Square"/);
    expect(svg).toContain('>Boca Town Square</text>');
    expect(svg).toContain('lengthAdjust="spacing"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });

  it('escapes names so they cannot inject markup', () => {
    const svg = mastheadSvg({
      siteName: 'A & B <Gazette>',
      style: 'left-motif',
      motif: 'lighthouse',
    });
    expect(svg).toContain('A &amp; B &lt;Gazette&gt;');
    expect(svg).not.toContain('<Gazette>');
  });

  it('styles differ in layout', () => {
    const a = mastheadSvg({
      siteName: 'Harbor Point Ledger',
      style: 'centered-serif',
      motif: 'lighthouse',
    });
    const b = mastheadSvg({
      siteName: 'Harbor Point Ledger',
      style: 'left-motif',
      motif: 'lighthouse',
    });
    expect(a).toContain('text-anchor="middle"');
    expect(b).not.toContain('text-anchor="middle"');
  });
});
