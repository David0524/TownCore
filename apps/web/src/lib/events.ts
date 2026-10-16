// Events from the town's official calendars (CivicPlus calendars of community events, nature
// centers, museums and theaters; the `events` source kind). Every event links to the city's own
// page for it.

/**
 * "Children's Science Explorium - 300 South Military Trail BOCA RATON FL 33486" → the venue and
 * its street. The town, state and ZIP are dropped: every event is in town. A location with no
 * " - " is the venue alone (or a bare street, shown as is).
 */
export function splitLocation(
  location: string | null | undefined,
  townName: string,
): {
  venue: string | null;
  street: string | null;
} {
  const text = location
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { venue: null, street: null };
  const at = text.indexOf(' - ');
  const venue = at > 0 ? text.slice(0, at).trim() : text;
  const rest = at > 0 ? text.slice(at + 3).trim() : '';
  const town = townName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const street = rest
    .replace(new RegExp(`,?\\s+${town},?\\s+[A-Z]{2},?\\s+\\d{5}(-\\d{4})?$`, 'i'), '')
    .trim();
  // Some locations repeat the street ("1801 North Ocean Blvd 1801 N Ocean Blvd"): keep the first.
  const first = street.split(/\s+(?=\d+\s)/)[0]!.trim();
  return { venue: venue || null, street: first || null };
}

/**
 * Two calendars often list the same event; keep one per title and start. With `oncePerTitle`,
 * a recurring class or program shows only at its next date (events must be soonest first).
 */
export function dedupeEvents<T extends { title: string; when: Date }>(
  events: T[],
  { oncePerTitle = false }: { oncePerTitle?: boolean } = {},
): T[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const title = e.title.trim().toLowerCase();
    const key = oncePerTitle ? title : `${title}|${e.when.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
