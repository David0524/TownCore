import { z } from 'zod';

// Meeting splitter (meeting recaps, one meeting → several stories). Reads a meeting's minutes
// or recorded actions, one chunk at a time, and lists each decision with a verbatim excerpt,
// any stated vote tally and where in the transcript it was discussed. Code checks every excerpt
// and tally against the records and drops what doesn't match (packages/pipeline/src/
// meeting-split.ts); each decision that survives is written and fact-checked as its own story.
// Off until recorded with `pnpm evals --live` (the `meeting-split` route is disabled).

const score = z.number().min(0).max(1);

export const meetingSplitSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      /** A short plain label: "Shoppes at Jupiter site plan amendment". */
      topic: z.string().min(3).max(160),
      /** The agenda number as the record writes it ("9.", "7.A."), or null. */
      agenda_number: z.string().max(20).nullable(),
      /** What was decided, in a few plain words: "approved as amended", "denied". */
      outcome: z.string().min(3).max(300),
      /** The vote exactly as the record states it ("5-0", "all were in favor"), or null. */
      vote_tally: z.string().max(200).nullable(),
      /** IDs of the minutes or actions records the excerpt comes from. */
      record_ids: z.array(z.string()).min(1),
      /** Copied word for word from the record: the item and its outcome. */
      minutes_excerpt: z.string().min(20).max(2500),
      /** Character positions in the transcript, from the outline's @ numbers, or null. */
      transcript_window: z
        .strictObject({ start: z.number().int().min(0), end: z.number().int().min(0) })
        .nullable(),
      newsworthy: z.boolean(),
      impact: score,
      novelty: score,
      proximity: score,
      reason: z.string().max(400),
    }),
  ),
});
export type MeetingSplit = z.infer<typeof meetingSplitSchema>;
export type MeetingSplitItem = MeetingSplit['items'][number];

export const meetingSplitV1 = {
  id: 'meeting-split',
  version: 'v1',
  task: 'meeting-split',
  schema: meetingSplitSchema,
  system: `You read the official minutes or recorded actions of one local government meeting and list the decisions in them, so each newsworthy decision can become its own short news story. You will get the town, part or all of the minutes or actions (each record with its ID; a long record arrives in numbered parts, and you see one part), and, when the meeting has a machine transcript, an outline of it: lines starting with @ and a character position, each followed by an agenda marker, a time, or the first words at that point. You never see the transcript itself.

List one item per decision: each motion, vote, approval, denial, adoption, award or continuance on an agenda item in this part. Leave out the call to order, roll call, invocation, pledge and adjournment. List a consent agenda as one item unless the record shows a separate vote on one of its items.

For each item:
- topic: a short plain label for what was decided.
- agenda_number: the item's number as written, or null.
- outcome: what was decided, in a few plain words.
- vote_tally: the vote copied exactly as the record states it ("5-0", "4-1", "all were in favor", "motion passed", or a row of Yes and No votes). Null if the record states no vote. Never work one out.
- record_ids: the ID of the record you copied the excerpt from.
- minutes_excerpt: copied word for word from that record, including the item's title and its outcome or motion. Don't fix spelling, capitals or line breaks, and don't join text from different places.
- transcript_window: when the outline shows where this item was discussed (usually its agenda marker), start = that line's @ position and end = the @ position of the next item's marker or a time well after it. Null when the outline doesn't show it. The transcript is only for finding the discussion: judge everything else from the minutes.
- newsworthy: true when residents would want a story on it on its own: money, a contract, a tax or fee, a rule or ordinance, a development or site plan, a street, park or service change, a split vote or a denial. False for approving earlier minutes or the agenda, proclamations, presentations, routine reports and items only discussed.
- impact, novelty, proximity (0–1): as for a news story: residents affected and money involved; a first, a reversal, a split vote or a denial; a specific street, school, park or landmark.
- reason: one sentence on why it is or isn't newsworthy.

Use only what the records say. If the part has no decisions, return an empty list.`,
} as const;
