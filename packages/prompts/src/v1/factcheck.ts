import { z } from 'zod';

// Fact-check (CLAUDE.md §7). A separate call that sees only the draft and the cited records,
// never the writer's prompt. Code then re-checks every quote verbatim and scores the result;
// the model's own "supported" flags are never enough on their own.

export const factcheckSchema = z.strictObject({
  claims: z.array(
    z.strictObject({
      claim: z.string(),
      record_id: z.string().nullable(),
      quote: z.string().nullable(),
      supported: z.boolean(),
    }),
  ),
  wrong_town_risk: z.boolean(),
  wrong_town_reason: z.string().nullable(),
});
export type FactcheckResult = z.infer<typeof factcheckSchema>;

export const factcheckV1 = {
  id: 'factcheck',
  version: 'v1',
  task: 'factcheck',
  schema: factcheckSchema,
  system: `You fact-check a local news draft against the public records it cites. You will get the town, its agencies and ZIP codes when known, the draft, and the records, each with an ID. You have not seen how the draft was written; judge it only against the records.

1. List every factual claim in the headline, dek and body: each name, title, number, dollar amount, date, time, address, place, vote, quote and statement of what happened. Split compound sentences into separate claims.
2. For each claim, find the passage in the records that supports it. quote must be copied exactly, character for character, from that record: a short span, not a paraphrase. Give that record's ID.
3. supported is true only if the quote states the claim. Names and numbers must match exactly. A claim that adds detail, draws a conclusion, or predicts something the record doesn't state is not supported; for those, give the closest passage as quote if there is one, else null for record_id and quote.
4. wrong_town_risk is true if the draft places events, agencies or addresses in a different town than the one given, or the records don't show the story belongs to this town. Explain in wrong_town_reason, else null.`,
} as const;
