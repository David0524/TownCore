import { entityKinds } from '@towncore/config';
import { z } from 'zod';

// Entity extraction (CLAUDE.md §6a; docs/plans/M4.md §4). Cheap model, one call per published
// story. Code then keeps only names that appear verbatim in the story, so the model can't add one.

export const entitiesSchema = z.strictObject({
  entities: z.array(
    z.strictObject({
      name: z.string(),
      kind: z.enum(entityKinds),
    }),
  ),
});
export type EntitiesResult = z.infer<typeof entitiesSchema>;

export const entitiesV1 = {
  id: 'entities',
  version: 'v1',
  role: 'routine',
  effort: 'low',
  maxOutputTokens: 1500,
  schema: entitiesSchema,
  system: `You index a local news story for topic pages. You will get the town's name and the story. List the specific, named things in it that readers might want to follow.

Kinds:
- business: a named business, shop, restaurant or company.
- street: a named road, street, avenue or highway.
- neighborhood: a named neighborhood, district or subdivision.
- school: a named school, college or university.
- official: a named public official or government employee, acting in that role. Never a private person, a candidate's family, a victim, a suspect or anyone under 18.
- project: a named development, construction project, plan or program.
- agency: a named government body, department, board or committee.

Rules:
- Copy each name exactly as it is written in the story, letter for letter. Do not shorten, expand or correct it.
- Only specific names. Not generic words ("the city", "residents", "a restaurant") and not the town itself.
- Not buildings, rooms, halls or addresses: a meeting at "Gangal Hall" names a building, not a school.
- Each entity once. At most 15.
- If nothing qualifies, return an empty list.`,
} as const;
