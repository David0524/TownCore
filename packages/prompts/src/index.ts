// Versioned prompts (CLAUDE.md §12). A wording change is a new version file, never an edit in
// place, so each article records exactly which prompts produced it. Eval sets live in evals/.
export { HOUSE_STYLE } from './style';
export { classifySchema, classifyV1, type Classification } from './v1/classify';
export { entitiesSchema, entitiesV1, type EntitiesResult } from './v1/entities';
export { factcheckSchema, factcheckV1, type FactcheckResult } from './v1/factcheck';
export { updateSchema, updateV1, type UpdateNote } from './v1/update';
export { writerSchema, writerV1, type WriterDraft } from './v1/writer';
