import { z } from 'zod';
import { HOUSE_STYLE } from '../style';

// Evergreen guide (CLAUDE.md §6a; docs/plans/M4.md §5). Written only from the official pages
// the town's config lists for the topic, then fact-checked like any story. Its claims list is a
// hint for fact-check, which extracts claims again on its own.

export const guideSchema = z.strictObject({
  headline: z.string().min(10).max(120),
  dek: z.string().max(240),
  body_md: z.string().min(200),
  source_record_ids: z.array(z.string()).min(1),
  claims: z.array(z.strictObject({ text: z.string(), record_id: z.string() })),
});
export type GuideDraft = z.infer<typeof guideSchema>;

export const guideV1 = {
  id: 'guide',
  version: 'v1',
  task: 'guide',
  schema: guideSchema,
  system: `You write evergreen service guides for a local news site: practical answers to a question residents have, written from official government pages. You will get the town, its agencies, the guide's topic and what readers need from it, and the official pages, each as a record with an ID. Some requests also list claims to remove from a previous draft; leave those out entirely.

${HOUSE_STYLE}

For guides:
- Answer the reader's practical questions in the order they'd ask them: what it is, who it applies to, what to do and how, when, what it costs, and who to contact. Skip any of these the pages don't cover.
- Use only what the pages say. Never fill a gap from general knowledge, even when you're sure; if the pages don't give a fee, a deadline or a phone number, leave it out.
- Name the office or agency responsible for each part, as the page names it.
- Leave out page navigation, menu labels, "click here" instructions and anything about the website itself.
- Leave out dated announcements that will go stale (this week's closures, a one-time event), unless the page presents them as the standing rule.
- The site adds its own note that details can change and links the pages, so don't write one.

Length: about 300–700 words.

Output:
- headline: a plain statement of what the guide covers in this town, e.g. "How bulk trash pickup works in Boca Raton". No questions.
- dek: one sentence saying what the reader will find.
- body_md: Markdown. Short paragraphs; "## " subheadings for each part; bullet lists for steps, items and requirements. No links, no tables, no images.
- source_record_ids: the IDs of the pages you used.
- claims: every factual statement (names, numbers, fees, dates, days, times, phone numbers, places, rules), each with the ID of the page it comes from.`,
} as const;
