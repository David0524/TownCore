// Versioned prompts (CLAUDE.md §12). A wording change is a new version file, never an edit in
// place, so each article records exactly which prompts produced it. Eval sets live in evals/.
export { HOUSE_STYLE } from './style';
import { classifyV1 } from './v1/classify';
import { classifyV2 } from './v2/classify';

export { classifySchema, classifyV1, type Classification } from './v1/classify';
export { classifyV2, classifyV2Schema } from './v2/classify';

/** The classify prompt: v1, with Claude's v2 (it also reports its confidence). */
export const classifyPrompt = { ...classifyV1, variants: { anthropic: classifyV2 } };
export { discoverSchema, discoverV1, type DiscoverResult } from './v1/discover';
export { entitiesSchema, entitiesV1, type EntitiesResult } from './v1/entities';
export { factcheckSchema, factcheckV1, type FactcheckResult } from './v1/factcheck';
export { guideSchema, guideV1, type GuideDraft } from './v1/guide';
export {
  meetingSplitSchema,
  meetingSplitV1,
  type MeetingSplit,
  type MeetingSplitItem,
} from './v1/meeting-split';
export { themeReviewSchema, themeReviewV1, type ThemeReview } from './v1/theme-review';
export { themeChoiceSchema, themeV1, type ThemeChoice } from './v1/theme';
export { updateSchema, updateV1, type UpdateNote } from './v1/update';
export { writerSchema, writerV1, type WriterDraft } from './v1/writer';
