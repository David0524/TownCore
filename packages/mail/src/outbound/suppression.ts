import { and, eq, inArray, isNull, ne, or, suppressions, type Db } from '@towncore/db';

// Suppression checks (brief §6, §7.2): before every send, in both streams. Hard bounces,
// complaints and manual blocks stop all mail; unsubscribes stop only bulk mail (Mail-5).

export type Stream = 'conversational' | 'bulk';

export type SuppressedAddress = { email: string; reason: string };

export async function suppressedAddresses(
  db: Db,
  emails: readonly string[],
  options: { domainId: string; stream: Stream },
): Promise<SuppressedAddress[]> {
  const list = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (!list.length) return [];
  const rows = await db
    .select({ email: suppressions.email, reason: suppressions.reason })
    .from(suppressions)
    .where(
      and(
        inArray(suppressions.email, list),
        or(isNull(suppressions.domainId), eq(suppressions.domainId, options.domainId)),
        options.stream === 'conversational' ? ne(suppressions.reason, 'unsubscribe') : undefined,
      ),
    );
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.email) && seen.add(r.email));
}

export async function suppress(
  db: Db,
  entry: {
    email: string;
    reason: 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual';
    domainId?: string | null;
    sourceEventId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await db
    .insert(suppressions)
    .values({
      email: entry.email.toLowerCase(),
      reason: entry.reason,
      scope: entry.domainId ? 'domain' : 'global',
      domainId: entry.domainId ?? null,
      sourceEventId: entry.sourceEventId ?? null,
      note: entry.note ?? null,
    })
    .onConflictDoNothing();
}
