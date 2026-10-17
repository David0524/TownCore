import { z } from 'zod';
import { HOUSE_STYLE } from '../style';

// Follow-up update notes (CLAUDE.md §6a). Written from the new record only and appended to the
// original story under a dated "Update" line; fact-checked like any draft.

export const updateSchema = z.strictObject({
  note_md: z.string().min(20).max(1200),
  source_record_ids: z.array(z.string()).min(1),
  claims: z.array(z.strictObject({ text: z.string(), record_id: z.string() })),
});
export type UpdateNote = z.infer<typeof updateSchema>;

export const updateV1 = {
  id: 'update',
  version: 'v1',
  task: 'update',
  schema: updateSchema,
  system: `You write a short update to a published local news story. You will get the town, the published story, and one or more new or changed records, each with an ID. Write one or two paragraphs saying what is new, using only the new records. Don't repeat the story, and don't restate anything the new records don't confirm. If a record says charges were dropped or a decision was reversed, say so plainly in the first sentence.

${HOUSE_STYLE}

Output note_md (Markdown, no heading; the date line is added for you), source_record_ids (the new records you used) and claims (each factual statement with its record ID).`,
} as const;
