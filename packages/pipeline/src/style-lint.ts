import { normalize } from './factcheck';

// Filler, speculation and deflection lint (CLAUDE.md §6: "No speculation"; Rule 7: never pad).
// A detector, never a deleter: its hits go to the writer's one revise like unsupported claims,
// and a draft that still has them after the revise waits for a person instead of publishing.
//
// Phrases come from Kyle's newsroom prompts and text guards (lib/ai/prompts.ts, text-guards.ts),
// kept only where they are filler or speculation in a paper written from records. Not flagged:
// "for more information, visit myboca.us/…" and "more information is available at <a city
// page>", which point readers at a real service (a sign-up, a schedule); only deflection to "the
// source", "the link" or "the article" is. To avoid false alarms on attributed text:
//   - words inside quotation marks are skipped (quotes are checked verbatim on their own), and
//   - a hit whose phrase and the next few words appear in a cited record is the record's own
//     wording ("The project is expected to finish in May"), so it isn't the writer's guess.

export type StyleHit = {
  rule: 'speculation' | 'filler' | 'deflection' | 'meta';
  /** The phrase as the draft has it. */
  phrase: string;
  /** The sentence it is in, for the revise and for reviewers. */
  sentence: string;
  field: 'headline' | 'dek' | 'body';
};

const RULES: { rule: StyleHit['rule']; why: string; pattern: RegExp }[] = [
  {
    rule: 'speculation',
    why: 'speculation: say only what the records state',
    pattern:
      /\b(?:is|are|was|were) (?:widely |generally )?(?:expected|likely) to\b|\btypically\b|\bit remains to be seen\b|\bonly time will tell\b|\bit (?:is|was|remains) (?:still )?(?:unclear|not (?:yet |immediately )?clear)\b|\bit'?s (?:still )?unclear\b|\bcould potentially\b/gi,
  },
  {
    rule: 'filler',
    why: 'filler: cut it, a short true story beats a padded one',
    pattern:
      /\b(?:this|it) is a developing story\b|\bthis story is developing\b|\bstay tuned\b|\bcheck back (?:later |here )?for (?:more |further )?updates\b|\b(?:details|information) (?:was|were) not (?:immediately )?available\b|\bat the time of (?:publishing|publication|writing)\b|\bas of press time\b/gi,
  },
  {
    rule: 'deflection',
    why: 'deflection: write the facts the records give instead of sending readers elsewhere',
    pattern:
      /\b(?:further|more|additional|full) (?:details?|information)\b[^.!?\n]*\b(?:available|found|provided)\b[^.!?\n]*\b(?:the|this) (?:linked |original )?(?:source|link|article|report)\b|\b(?:see|visit|read) the (?:linked |original )?(?:source|link|article)\b|\bthe (?:linked |original )?source (?:has|provides|contains) (?:the )?(?:full|complete|more)\b/gi,
  },
  {
    rule: 'meta',
    why: 'not news writing: no refusals or talk about the records or the writer',
    pattern:
      /(?:^|[.!?]\s+)I (?:can(?:no|')t|cannot|am unable|'m unable|am not able|'m not able)\b|\bas an AI\b|\blanguage model\b|\bplease (?:paste|provide|share|send)\b|\bthe (?:provided|given|source) (?:records?|sources?|text|material|documents?)\b|\b(?:records?|sources?) (?:do|does|did) not (?:say|specify|state|mention|include)\b|\bnot (?:specified|stated|mentioned) in the (?:records?|sources?)\b/gim,
  },
];

export const STYLE_WHY: Record<StyleHit['rule'], string> = Object.fromEntries(
  RULES.map((r) => [r.rule, r.why]),
) as Record<StyleHit['rule'], string>;

/** Blanks out text inside double quotation marks, keeping offsets. */
function maskQuotes(text: string): string {
  return text.replace(/"[^"\n]*"|“[^“”\n]*”/g, (m) => ' '.repeat(m.length));
}

function sentenceAt(text: string, index: number): string {
  const start = Math.max(
    text.lastIndexOf('. ', index) + 1,
    text.lastIndexOf('\n', index) + 1,
    text.lastIndexOf('? ', index) + 1,
    text.lastIndexOf('! ', index) + 1,
  );
  const ends = ['. ', '\n', '? ', '! '].map((e) => text.indexOf(e, index)).filter((n) => n >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start, end).trim();
}

/** The phrase and up to the next three words: the window that must be in a record to excuse it. */
function windowAt(text: string, index: number, length: number): string {
  const after = text.slice(index + length).match(/^(?:\s+[^\s.!?]+){0,3}/)?.[0] ?? '';
  return normalize(text.slice(index, index + length) + after).toLowerCase();
}

export function lintStyle(
  draft: { headline: string; dek: string; bodyMd: string },
  sources: { title: string | null; text: string | null }[] = [],
): StyleHit[] {
  const records = sources.map((s) => normalize(`${s.title ?? ''}\n${s.text ?? ''}`).toLowerCase());
  const hits: StyleHit[] = [];
  const fields = [
    ['headline', draft.headline],
    ['dek', draft.dek],
    ['body', draft.bodyMd],
  ] as const;
  for (const [field, text] of fields) {
    const masked = maskQuotes(text);
    for (const { rule, pattern } of RULES) {
      for (const match of masked.matchAll(pattern)) {
        const leading = match[0].match(/^(?:[.!?]\s+)/)?.[0].length ?? 0;
        const index = match.index + leading;
        const phrase = match[0].slice(leading);
        if (records.some((r) => r.includes(windowAt(text, index, phrase.length)))) continue;
        hits.push({ rule, phrase, sentence: sentenceAt(text, index), field });
      }
    }
  }
  return hits;
}

/** One line per hit for the writer's revise, the same shape as an unsupported claim. */
export function styleRevisionLines(hits: StyleHit[]): string[] {
  return hits.map((h) => `- "${h.phrase}" in "${h.sentence}" (${STYLE_WHY[h.rule]})`);
}
