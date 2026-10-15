// Threading helpers (brief Phase 2): headers first, then a same-contact, same-address,
// same-subject fallback within a window. The database lookups live in the processor.

/** Days a reply without usable headers may still join an earlier thread by subject. */
export const THREAD_FALLBACK_DAYS = 30;

const PREFIX =
  /^\s*(?:(?:re|fw|fwd|aw|wg|sv|vs|antw|rif|tr|r)\s*(?:\[\d+\]|\(\d+\))?\s*[:：]\s*)+/i;

/** "RE: Fwd: [EXT] Hello  there" → "[ext] hello there". */
export function normalizeSubject(subject: string): string {
  let s = subject;
  for (let previous = ''; previous !== s;) {
    previous = s;
    s = s.replace(PREFIX, '');
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Message-IDs this message answers, most direct first. */
export function referencedIds(message: {
  inReplyTo: string | null;
  references: string[];
}): string[] {
  return [
    ...new Set([
      ...(message.inReplyTo ? [message.inReplyTo] : []),
      ...[...message.references].reverse(),
    ]),
  ];
}
