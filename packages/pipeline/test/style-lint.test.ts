import { describe, expect, it } from 'vitest';
import { lintStyle, styleRevisionLines } from '../src/style-lint';

const body = (bodyMd: string, sources: { title: string | null; text: string | null }[] = []) =>
  lintStyle({ headline: 'Council approves paving contract', dek: '', bodyMd }, sources);
const phrases = (bodyMd: string, sources?: { title: string | null; text: string | null }[]) =>
  body(bodyMd, sources).map((h) => h.phrase);

describe('lintStyle', () => {
  it('finds speculation, filler, deflection and refusals', () => {
    expect(
      phrases(
        [
          'The new lanes are expected to ease traffic. Projects like this typically run late.',
          'It remains to be seen whether the council agrees. It is unclear who will pay.',
          'This story is developing. Stay tuned. Details were not available at the time of publishing.',
          'Further details are available at the linked source. Visit the source for more.',
          "I can't write this story. The records do not say when. Per the provided records, crews start Monday.",
        ].join('\n\n'),
      ),
    ).toEqual([
      'are expected to',
      'typically',
      'It remains to be seen',
      'It is unclear',
      'This story is developing',
      'Stay tuned',
      'Details were not available',
      'at the time of publishing',
      'Further details are available at the linked source',
      'Visit the source',
      "I can't",
      'records do not say',
      'the provided records',
    ]);
  });

  it('gives each hit its sentence and field', () => {
    const hits = lintStyle({
      headline: 'Road work is likely to slow drivers',
      dek: 'Crews start Monday.',
      bodyMd: 'Crews start Monday. The work is expected to last a week.',
    });
    expect(hits).toEqual([
      {
        rule: 'speculation',
        phrase: 'is likely to',
        sentence: 'Road work is likely to slow drivers',
        field: 'headline',
      },
      {
        rule: 'speculation',
        phrase: 'is expected to',
        sentence: 'The work is expected to last a week.',
        field: 'body',
      },
    ]);
    expect(styleRevisionLines(hits)[1]).toBe(
      '- "is expected to" in "The work is expected to last a week." (speculation: say only what the records state)',
    );
  });

  it('leaves real service information and plain news alone', () => {
    expect(
      phrases(
        [
          'For more information, visit myboca.us/1467/Veterans-Day.',
          'More information and online marketplace applications are available at myboca.us/1467/Veterans-Day.',
          'The meeting is set to begin at 5:30 p.m. The department said it cannot confirm the cause.',
          'Police said the investigation remains open.',
        ].join(' '),
      ),
    ).toEqual([]);
  });

  it("skips words inside quotation marks and the record's own wording", () => {
    expect(
      phrases('"It remains to be seen how many residents will come," the mayor said.'),
    ).toEqual([]);
    const record = {
      title: 'Glades Road work',
      text: 'The project is expected to be completed in spring 2027, the city said.',
    };
    expect(phrases('The project is expected to be completed in spring 2027.', [record])).toEqual(
      [],
    );
    // The same phrase on a guess the record doesn't make is still flagged.
    expect(phrases('The project is expected to lower water bills.', [record])).toEqual([
      'is expected to',
    ]);
  });
});
