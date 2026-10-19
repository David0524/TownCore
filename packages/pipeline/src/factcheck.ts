import { factcheckPassScore } from '@towncore/config';
import type { FactcheckResult } from '@towncore/prompts';

// Code checks on top of the fact-check model (CLAUDE.md §7). The model lists claims and quotes;
// code decides. A claim counts only if its quote is found verbatim in the record it cites, and
// every number and proper name in the draft must appear in a cited record (or be the town's own
// name or agencies), and every quotation in it must be word for word in one cited record.
// Thresholds live in config.

export type SourceText = { id: string; title: string | null; text: string | null };

export type CheckedClaim = {
  claim: string;
  recordId: string | null;
  quote: string | null;
  supported: boolean;
  /** Why code marked it unsupported, when it did. */
  problem?: string;
};

export type FactcheckReport = {
  score: number;
  claims: CheckedClaim[];
  unsupportedClaims: string[];
  wrongTownRisk: boolean;
  wrongTownReason: string | null;
  decision: 'pass' | 'revise' | 'review';
};

/** Whitespace and quote-mark differences only; case and every other character must match. */
export function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sourceBody = (s: SourceText) => normalize(`${s.title ?? ''}\n${s.text ?? ''}`);

// Markdown syntax that never counts as content.
const stripMarkdown = (md: string) =>
  md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>#]/g, ' ');

/** Numbers as written in the draft: 1,200 / 3.5 / 27 / 2026 / 15%. */
export function numbersIn(text: string): string[] {
  return [...new Set(text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])].map((n) => n.replace(/,$/, ''));
}

const NAME_STOPWORDS = new Set([
  'The',
  'A',
  'An',
  'On',
  'In',
  'At',
  'For',
  'This',
  'That',
  'These',
  'Those',
  'It',
  'Its',
  'After',
  'Before',
  'Under',
  'From',
  'With',
  'And',
  'But',
  'If',
  'When',
  'Where',
  'According',
]);
const CALENDAR =
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Aug|Sept|Oct|Nov|Dec)\.?$/;

/** Runs of two or more capitalized words ("Mayor Scott Singer", "Mizner Park"). */
export function namesIn(text: string): string[] {
  const found = new Set<string>();
  // A name never spans a line or a sentence end ("…Park Road. Work begins…").
  for (const sentence of text.split(/\n|(?<=[A-Za-z0-9)][.!?])\s+/)) {
    for (const name of namesInSentence(sentence)) found.add(name);
  }
  return [...found];
}

function namesInSentence(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z][\w'.&-]*(?:\s+(?:of\s+|de\s+)?[A-Z][\w'.&-]*)+/g)) {
    const words = match[0].split(/\s+/);
    while (words.length && (NAME_STOPWORDS.has(words[0]!) || CALENDAR.test(words[0]!))) {
      words.shift();
    }
    while (words.length && CALENDAR.test(words.at(-1)!)) words.pop();
    const name = words.join(' ').replace(/[.,]$/, '');
    if (name.split(' ').length >= 2) found.add(name);
  }
  return [...found];
}

// Quoted spans shorter than this are scare quotes, titles and terms ("the 'smart growth' plan",
// the "Boo-ca Boo Days" series), not speech; checking them would flag real copy. Speech of four
// words or more and 25 characters or more is checked (Kyle's quote check uses the same floor).
// Their names and numbers are still checked like any other text.
const MIN_QUOTE_CHARS = 25;
const MIN_QUOTE_WORDS = 4;
// A runaway draft can't produce hundreds of claims.
const MAX_QUOTES = 40;

/** Punctuation a writer adds when a quote is folded into a sentence ("…," she said). */
const trimQuoteEdges = (s: string) =>
  s.replace(/^[\s.,;:!?'"-]+/, '').replace(/[\s.,;:!?'"-]+$/, '');

/**
 * Spans inside double quotation marks (straight or curly) long enough to be speech. A quote
 * never spans a paragraph, so an unbalanced mark can't pair with one paragraphs away; a split
 * quote ("…," she said, "…") gives two spans, each checked on its own.
 */
export function quotedSpans(markdown: string): string[] {
  const out: string[] = [];
  for (const paragraph of stripLinks(markdown).split(/\n/)) {
    for (const match of paragraph.matchAll(/"([^"]{1,600})"|“([^“”]{1,600})”/g)) {
      const span = trimQuoteEdges(match[1] ?? match[2] ?? '');
      if (span.length >= MIN_QUOTE_CHARS && span.split(/\s+/).length >= MIN_QUOTE_WORDS) {
        out.push(span);
      }
    }
  }
  return [...new Set(out)].slice(0, MAX_QUOTES);
}

const stripLinks = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/**
 * True when the quote appears verbatim in the record: normalize() only (whitespace, quote
 * marks, dashes), case kept, except a first letter capitalized to start the quote. An elision
 * ("…" or "...") splits it into fragments that must each appear, in order.
 */
export function quoteInRecord(quote: string, record: string): boolean {
  const fragments = normalize(quote)
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map(trimQuoteEdges)
    .filter(Boolean);
  if (fragments.length === 0) return true;
  const firstVariants = (f: string) => [f, f[0]!.toLowerCase() + f.slice(1)];
  let cursor = 0;
  for (const [i, fragment] of fragments.entries()) {
    const at = (i === 0 ? firstVariants(fragment) : [fragment])
      .map((f) => record.indexOf(f, cursor))
      .filter((n) => n >= 0)
      .sort((a, b) => a - b)[0];
    if (at === undefined) return false;
    cursor = at + fragment.length;
  }
  return true;
}

export function checkDraft(input: {
  draft: { headline: string; dek: string; bodyMd: string };
  sources: SourceText[];
  model: FactcheckResult;
  /** Names that are always fine: the town, its agencies, the state, the site. */
  knownNames: string[];
  /** Other towns that could be confused with this one. */
  otherPlaces: string[];
}): FactcheckReport {
  const { draft, sources, model } = input;
  const byId = new Map(sources.map((s) => [s.id, sourceBody(s)]));
  const allSources = [...byId.values()].join('\n');

  const claims: CheckedClaim[] = model.claims.map((c) => {
    const base = { claim: c.claim, recordId: c.record_id, quote: c.quote };
    if (!c.supported) return { ...base, supported: false, problem: 'model found no support' };
    if (!c.record_id || !byId.has(c.record_id)) {
      return { ...base, supported: false, problem: 'cites a record the draft did not use' };
    }
    if (!c.quote || !byId.get(c.record_id)!.includes(normalize(c.quote))) {
      return { ...base, supported: false, problem: 'quote not found verbatim in the record' };
    }
    return { ...base, supported: true };
  });

  // Every number and name in the draft must be in a cited record, character for character.
  const rawDraft = stripMarkdown(`${draft.headline}\n${draft.dek}\n${draft.bodyMd}`);
  const draftText = normalize(rawDraft);
  const known = input.knownNames.map(normalize);
  for (const number of numbersIn(draftText)) {
    if (!allSources.includes(number)) {
      claims.push({
        claim: `the number ${number}`,
        recordId: null,
        quote: null,
        supported: false,
        problem: 'number not found in any cited record',
      });
    }
  }
  // Subheadings ("## How to apply") are the writer's own section labels, not names from the
  // records; their numbers are still checked above.
  const nameText = stripMarkdown(
    [
      draft.headline,
      draft.dek,
      ...draft.bodyMd.split('\n').filter((line) => !/^\s*#{1,6}\s/.test(line)),
    ].join('\n'),
  );
  for (const name of namesIn(nameText.split('\n').map(normalize).join('\n'))) {
    if (!allSources.includes(name) && !known.some((k) => k.includes(name))) {
      claims.push({
        claim: `the name "${name}"`,
        recordId: null,
        quote: null,
        supported: false,
        problem: 'name not found in any cited record',
      });
    }
  }

  // Every quotation in the dek and body must be in one cited record, word for word (§6: no
  // quotes that aren't verbatim in a source). Code decides, whatever the model said.
  for (const quote of quotedSpans(`${draft.dek}\n${draft.bodyMd}`)) {
    if (![...byId.values()].some((body) => quoteInRecord(quote, body))) {
      claims.push({
        claim: `the quotation "${quote}"`,
        recordId: null,
        quote: null,
        supported: false,
        problem: 'quoted text not found verbatim in any cited record',
      });
    }
  }

  const otherPlace = input.otherPlaces.find(
    (place) => draftText.includes(place) && !allSources.includes(place),
  );
  const wrongTownRisk = model.wrong_town_risk || Boolean(otherPlace);
  const wrongTownReason = model.wrong_town_reason ?? (otherPlace ? `mentions ${otherPlace}` : null);

  const supported = claims.filter((c) => c.supported).length;
  const score = claims.length === 0 ? 0 : supported / claims.length;
  const unsupportedClaims = claims
    .filter((c) => !c.supported)
    .map((c) => `${c.claim} (${c.problem})`);
  const passes = score >= factcheckPassScore && unsupportedClaims.length === 0 && !wrongTownRisk;
  return {
    score: Math.round(score * 1000) / 1000,
    claims,
    unsupportedClaims,
    wrongTownRisk,
    wrongTownReason,
    decision: passes ? 'pass' : wrongTownRisk ? 'review' : 'revise',
  };
}
