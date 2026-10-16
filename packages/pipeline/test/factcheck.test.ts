import type { FactcheckResult } from '@towncore/prompts';
import { describe, expect, it } from 'vitest';
import { checkDraft, namesIn, numbersIn } from '../src/factcheck';

const record = {
  id: 'r1',
  title: 'Council approves paving contract',
  text: 'The Boca Raton City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface Palmetto Park Road. Work begins Nov. 2.',
};
const draft = {
  headline: 'Council approves paving contract for Palmetto Park Road',
  dek: 'Work begins Nov. 2.',
  bodyMd:
    'The Boca Raton City Council voted 4-1 on Tuesday to approve a $2,500,000 contract with Acme Paving to resurface **Palmetto Park Road**.',
};
const knownNames = ['Boca Raton', 'City of Boca Raton'];
const claim = (over: Partial<FactcheckResult['claims'][number]> = {}) => ({
  claim: 'The council voted 4-1',
  record_id: 'r1',
  quote: 'voted 4-1 on Tuesday',
  supported: true,
  ...over,
});
const model = (claims: FactcheckResult['claims'], over: Partial<FactcheckResult> = {}) => ({
  claims,
  wrong_town_risk: false,
  wrong_town_reason: null,
  ...over,
});
const check = (m: FactcheckResult, d = draft, otherPlaces: string[] = []) =>
  checkDraft({ draft: d, sources: [record], model: m, knownNames, otherPlaces });

describe('checkDraft', () => {
  it('passes when every quote is verbatim and every name and number is in the record', () => {
    const report = check(
      model([
        claim(),
        claim({ claim: 'contract', quote: 'a $2,500,000 contract with Acme Paving' }),
      ]),
    );
    expect(report).toMatchObject({ score: 1, decision: 'pass', unsupportedClaims: [] });
  });

  it('tolerates curly quotes and line breaks, but not paraphrase or case changes', () => {
    expect(check(model([claim({ quote: 'voted 4-1\n on   Tuesday' })])).decision).toBe('pass');
    const paraphrase = check(model([claim({ quote: 'voted four to one on Tuesday' })]));
    expect(paraphrase.decision).toBe('revise');
    expect(paraphrase.unsupportedClaims[0]).toMatch(/quote not found verbatim/);
    expect(check(model([claim({ quote: 'Voted 4-1 on Tuesday' })])).decision).toBe('revise');
  });

  it("never trusts the model's own 'supported' without a record and a quote", () => {
    expect(check(model([claim({ record_id: 'r9' })])).unsupportedClaims[0]).toMatch(/did not use/);
    expect(check(model([claim({ quote: null })])).decision).toBe('revise');
    expect(check(model([claim({ supported: false })])).decision).toBe('revise');
    // No claims at all scores 0, so it can't pass.
    expect(check(model([])).score).toBe(0);
  });

  it('flags numbers and names in the draft that no record contains', () => {
    const report = check(model([claim()]), {
      ...draft,
      bodyMd: `${draft.bodyMd} Mayor Pat Doe said the $2.5 million job will take 90 days.`,
    });
    expect(report.decision).toBe('revise');
    expect(report.unsupportedClaims).toEqual(
      expect.arrayContaining([
        'the number 2.5 (number not found in any cited record)',
        'the number 90 (number not found in any cited record)',
        'the name "Mayor Pat Doe" (name not found in any cited record)',
      ]),
    );
  });

  it("leaves the writer's own subheadings out of the name check, but not their numbers", () => {
    const withHeadings = (heading: string) =>
      check(model([claim()]), { ...draft, bodyMd: `## ${heading}\n${draft.bodyMd}` });
    expect(withHeadings('How Paving Works').decision).toBe('pass');
    expect(withHeadings('Phase 3 Begins').unsupportedClaims).toEqual([
      'the number 3 (number not found in any cited record)',
    ]);
    // A name in a body sentence is still checked.
    expect(
      check(model([claim()]), { ...draft, bodyMd: `${draft.bodyMd}\nThe work is led by Pat Doe.` })
        .unsupportedClaims,
    ).toEqual(['the name "Pat Doe" (name not found in any cited record)']);
  });

  it('sends wrong-town risk straight to review', () => {
    expect(
      check(model([claim()], { wrong_town_risk: true, wrong_town_reason: 'x' })).decision,
    ).toBe('review');
    const other = check(model([claim()]), { ...draft, dek: 'Boca Raton, New Mexico news.' }, [
      'Boca Raton, New Mexico',
    ]);
    expect(other).toMatchObject({
      decision: 'review',
      wrongTownReason: 'mentions Boca Raton, New Mexico',
    });
  });
});

describe('extractors', () => {
  it('numbersIn', () => {
    expect(numbersIn('Voted 4-1 for $2,500,000, 15% and 3.5 miles, in 2026.')).toEqual([
      '4',
      '1',
      '2,500,000',
      '15',
      '3.5',
      '2026',
    ]);
  });

  it('namesIn skips sentence starters and calendar words', () => {
    expect(
      namesIn(
        'The City Council met Tuesday. On Monday, Oct. 19 Mayor Scott Singer spoke at Mizner Park.',
      ),
    ).toEqual(['City Council', 'Mayor Scott Singer', 'Mizner Park']);
  });

  it('namesIn ends a sentence after a capital letter too ("…on A1A. Bark Beach…")', () => {
    expect(namesIn('Parking is along State Road A1A. Bark Beach opens at 8.')).toEqual([
      'State Road A1A',
      'Bark Beach',
    ]);
  });
});
