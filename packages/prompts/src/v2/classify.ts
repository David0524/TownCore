import { z } from 'zod';
import { classifySchema, classifyV1 } from '../v1/classify';

// Classify v2: v1 plus a confidence the model reports, so a low-confidence answer from the small
// model is checked again on the mid-size one (owner, 2026-10-17, model protocol: escalation).
// Claude only for now: Gemini keeps v1, whose recorded responses CI replays.

export const classifyV2Schema = classifySchema.extend({ confidence: z.number().min(0).max(1) });

export const classifyV2 = {
  ...classifyV1,
  version: 'v2',
  schema: classifyV2Schema,
  system: `${classifyV1.system}
- confidence (0–1): how sure you are of the beat, about_this_town, every person's role and the proposed tier together. Below 0.6 means another reader should check: the records are ambiguous, the town is unclear, or a person's role is a guess.`,
} as const;
