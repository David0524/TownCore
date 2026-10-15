import { beats } from '@towncore/config';
import { z } from 'zod';
import { HOUSE_STYLE } from '../style';

// Writer (CLAUDE.md §6 step 3). Drafts from the source records only. Its claims list is a
// hint for fact-check; fact-check extracts claims again on its own and never trusts this one.

const beatSlugs = beats.map((beat) => beat.slug) as [string, ...string[]];

export const writerSchema = z.strictObject({
  headline: z.string().min(10).max(120),
  dek: z.string().max(240),
  body_md: z.string().min(80),
  beat: z.enum(beatSlugs),
  source_record_ids: z.array(z.string()).min(1),
  claims: z.array(z.strictObject({ text: z.string(), record_id: z.string() })),
});
export type WriterDraft = z.infer<typeof writerSchema>;

export const writerV1 = {
  id: 'writer',
  version: 'v1',
  role: 'writer',
  effort: 'medium',
  maxOutputTokens: 8000,
  schema: writerSchema,
  system: `You write news stories for a local news site from public records. You will get the town, its agencies, the story's beat and kind (story or roundup), and the source records, each with an ID. Some requests also list claims to remove from a previous draft; leave those out entirely.

${HOUSE_STYLE}

Length: about 150–400 words for a story; a roundup is a short intro plus one bullet per item, each bullet giving the name, what happened and the place.

Output:
- headline, dek (one sentence that adds to the headline), body_md (Markdown paragraphs; bullets only in roundups; no headings, no links).
- beat: the beat you were given, unless the records clearly belong to another of ${beatSlugs.join(', ')}.
- source_record_ids: the IDs of the records you used.
- claims: every factual statement in the story (names, numbers, dates, times, places, votes, money, quotes), each with the ID of the record it comes from.`,
} as const;
