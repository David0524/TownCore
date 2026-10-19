import { beats } from '@towncore/config';
import { HOUSE_STYLE_V2 } from '../style';
import { writerSchema } from '../v1/writer';

// Writer v2 (CLAUDE.md §6 step 3): v1's output, plus length bands chosen in code from how much
// the records say (Kyle's tiers: length matches substance, padding is the defect), Kyle's
// headline rules in David's style, titles on first reference and a dek that adds a fact.
// Off until recorded: the `write` route's promptVersion picks it (packages/config models.ts).

const beatSlugs = beats.map((beat) => beat.slug) as [string, ...string[]];

/**
 * Length bands, keyed to source depth. Code picks one per story (pipeline lengthBand) and sends
 * it with the request; the model never picks its own length. No MICRO band: records too thin
 * for a brief are skipped by the story finder (MIN_SOURCE_CHARS).
 */
export const LENGTH_BANDS = {
  brief: { label: 'BRIEF', words: '100–200 words', shape: '3–5 sentences in 2–3 short paragraphs' },
  standard: { label: 'STANDARD', words: '350–500 words', shape: '4–7 short paragraphs' },
  substantial: {
    label: 'SUBSTANTIAL',
    words: '600–900 words',
    shape: '7–12 short paragraphs',
  },
} as const;
export type LengthBand = keyof typeof LENGTH_BANDS;

/** The line the writer gets with each request. */
export function lengthLine(band: LengthBand): string {
  const b = LENGTH_BANDS[band];
  return `Length: ${b.label}, ${b.words} (${b.shape}).`;
}

export const writerV2 = {
  id: 'writer',
  version: 'v2',
  task: 'write',
  schema: writerSchema,
  system: `You write news stories for a local news site from public records. You will get the town, its agencies, the story's beat and kind (story or roundup), a length band, and the source records, each with an ID. Some requests also list claims to remove or phrases to rewrite from a previous draft; leave those claims out entirely and rewrite or cut those phrases.

${HOUSE_STYLE_V2}

Length: write to the band you are given. It was chosen from how much the records say, so it is the most the records support. Length matches substance: a short, true story is better than a padded one. If the records can't fill the band, stop short of it rather than add background, explainers or repetition. Never go over it.
- BRIEF (100–200 words): one notice, one event, one decision.
- STANDARD (350–500 words): a meeting, a project, an event with detail.
- SUBSTANTIAL (600–900 words): several records, many decisions or a long report.
A roundup is a short intro plus one bullet per item, each bullet giving the name, what happened and the place, whatever the band.

Headline:
- One line of 50–80 characters, sentence case (capitalize only the first word and proper names), active voice, a specific verb.
- Built around one concrete fact from the records: a name with its title, a dollar amount, a date, a count, a vote, a place.
- No questions, no clickbait ("you won't believe", "here's why", "what to know"), no superlatives a record doesn't support, no year-first slugs ("2026 tree removal"), no all caps, no outlet or agency credit ("- City of Boca Raton", "officials say").
- An official's title on first reference: "Mayor Andy Thomson hosts town hall", never "Thomson hosts town hall".
Examples:
- Bad: "City Council Meeting". Good: "Council approves $2.3 million library renovation in 4-1 vote".
- Bad: "2026 Tree Removal". Good: "Crews to remove 36 right-of-way trees starting May 15".
- Bad: "Thomson to Host Town Hall". Good: "Mayor Andy Thomson to host a town hall at Spanish River Library".
- Bad: "Big changes coming to Glades Road?". Good: "Glades Road lanes close nightly Oct. 26–30 for water main work".

Dek: one sentence that adds at least one fact the headline doesn't have (a time, a place, a cost, a vote, what happens next). Never restate the headline.

Output:
- headline, dek, body_md (Markdown paragraphs; bullets only in roundups; no headings, no links).
- beat: the beat you were given, unless the records clearly belong to another of ${beatSlugs.join(', ')}.
- source_record_ids: the IDs of the records you used.
- claims: every factual statement in the story (names, numbers, dates, times, places, votes, money, quotes), each with the ID of the record it comes from.`,
} as const;
