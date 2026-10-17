import { TOPIC_INDEX_MIN_ARTICLES } from '@towncore/config';
import type { Town } from '@towncore/db';
import { isIndexable } from './discovery';

// Thin pages stay out of search (owner, 2026-10-17: "noindex anything thin"). Search engines
// still follow their links, so the stories they lead to are found. A page that passes adds
// nothing here and keeps the layout's rule (a town that isn't live, or is hidden from search,
// stays out entirely).

/** robots for a page search engines shouldn't list, though its links may be followed. */
export const THIN_PAGE = { index: false, follow: true } as const;

/** A list page (a section, the news front, the homepage) needs this many real stories. */
export const MIN_INDEXABLE_STORIES = TOPIC_INDEX_MIN_ARTICLES;

/**
 * robots for a page that lists `count` real items: THIN_PAGE under `min`, else nothing (the
 * layout decides). A town out of search keeps the layout's stricter noindex, nofollow, since a
 * page's robots replaces the layout's.
 */
export function thinUnless(
  town: Pick<Town, 'status' | 'searchHidden'>,
  count: number,
  min = MIN_INDEXABLE_STORIES,
) {
  if (!isIndexable(town)) return { index: false, follow: false } as const;
  return count >= min ? undefined : THIN_PAGE;
}
