import type { FactcheckResult } from '@towncore/prompts';
import { describe, expect, it } from 'vitest';
import { checkDraft, namesIn, numbersIn, quotedSpans } from '../src/factcheck';

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

// Modeled on Kyle's quote-check tests: false alarms matter as much as catches, since a check
// that cries wolf gets ignored.
describe('quotations (checked in code, whatever the model said)', () => {
  const speech = {
    id: 'r2',
    title: 'Mayor on the water main',
    text: 'Mayor Julia Kim told the council on Tuesday that "the water main replacement will finish before the school year starts." Chief Ana Alvarez said the department "responded to 214 calls last month" and expects that number to climb.',
  };
  const withBody = (bodyMd: string, dek = 'Work begins Nov. 2.') =>
    checkDraft({
      draft: { headline: draft.headline, dek, bodyMd },
      sources: [record, speech],
      model: model([claim()]),
      knownNames: [...knownNames, 'Mayor Julia Kim', 'Chief Ana Alvarez'],
      otherPlaces: [],
    });
  const quoteProblems = (bodyMd: string, dek?: string) =>
    withBody(bodyMd, dek).unsupportedClaims.filter((c) => c.includes('quoted text'));

  it('passes a verbatim quote, straight or curly, with a capitalized first letter', () => {
    expect(
      withBody('Kim said "the water main replacement will finish before the school year starts."')
        .decision,
    ).toBe('pass');
    expect(
      quoteProblems(
        'Kim said “The water main replacement will finish before the school year starts.”',
      ),
    ).toEqual([]);
  });

  it('flags a fabricated or paraphrased quote, which sends the draft to the one revise', () => {
    const report = withBody('Kim said "we will lower taxes for every resident next year."');
    expect(report.decision).toBe('revise');
    expect(report.unsupportedClaims).toEqual([
      'the quotation "we will lower taxes for every resident next year" (quoted text not found verbatim in any cited record)',
    ]);
    // A paraphrase in quotation marks, and a case change past the first letter, aren't verbatim.
    expect(
      quoteProblems('"The water main work will finish before school starts," Kim said.'),
    ).toHaveLength(1);
    expect(
      quoteProblems('Kim said "the Water Main replacement will finish before the school year."'),
    ).toHaveLength(1);
  });

  it('checks the dek too', () => {
    expect(
      quoteProblems(draft.bodyMd, 'Kim: "we will lower taxes for every resident next year"'),
    ).toHaveLength(1);
  });

  it('leaves short scare quotes and titles alone', () => {
    expect(
      quoteProblems('The so-called "smart growth" plan and the "Boo-ca Boo Days" series.'),
    ).toEqual([]);
  });

  it('allows an elision when each fragment appears in order in one record', () => {
    expect(
      quoteProblems(
        'Alvarez said the department "responded to 214 calls ... expects that number to climb."',
      ),
    ).toEqual([]);
    expect(
      quoteProblems('Alvarez said the department "responded to 214 calls … last month"'),
    ).toEqual([]);
    // Out of order, or fragments from two different records, is not a quote.
    expect(
      quoteProblems('Alvarez said "expects that number to climb ... responded to 214 calls."'),
    ).toHaveLength(1);
    expect(
      quoteProblems('Officials said "voted 4-1 on Tuesday ... responded to 214 calls last month."'),
    ).toHaveLength(1);
  });

  it('checks each half of a split quote on its own, and a repeated quote once', () => {
    expect(
      quoteProblems(
        '"The water main replacement will finish," Kim said, "before the school year starts."',
      ),
    ).toEqual([]);
    expect(
      quoteProblems(
        'Kim said "we will lower taxes for every resident next year." Later: "we will lower taxes for every resident next year."',
      ),
    ).toHaveLength(1);
  });

  it('never pairs quotation marks across paragraphs', () => {
    expect(
      quotedSpans('He said "the first paragraph has a stray mark.\n\nThe second ends" here.'),
    ).toEqual([]);
  });
});
