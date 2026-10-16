import { z } from 'zod';

// What a paid campaign may put in a slot, on the site or in the newsletter (CLAUDE.md §11b).
// Text-only for now; images arrive with the image rules (M4/M9).
export const creativeSchema = z.strictObject({
  headline: z.string().min(1).max(90),
  body: z.string().max(200).optional(),
  // An absolute URL, or a path on the town's own site (sponsored directory cards link to the
  // business's listing).
  href: z.union([
    z.url(),
    z
      .string()
      .regex(/^\/[a-z0-9]/i)
      .max(300),
  ]),
  cta: z.string().max(30).optional(),
  advertiser: z.string().min(1).max(80),
});
export type Creative = z.infer<typeof creativeSchema>;
