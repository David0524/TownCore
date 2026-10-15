import type { HomeModule } from '@towncore/config';
import {
  BeatSections,
  BriefingColumn,
  Briefs,
  LatestList,
  LeadStory,
  NewsletterCta,
  TodayBento,
} from './news';
import { CategoryButtons, ComingUp, DocumentsPosted, GoodMorning } from './front';
import type { HomeModuleComponent } from './types';

// Modules whose data arrives in a later milestone. They render nothing until then, exactly
// like a module with no data today (CLAUDE.md §11a-2: modules hide when empty).
const awaitingData =
  (_reason: string): HomeModuleComponent =>
  async () =>
    null;

// One component per module in the theme schema; the Record type fails the build on a gap.
export const homeModules: Record<HomeModule, HomeModuleComponent> = {
  'good-morning': GoodMorning,
  'today-bento': TodayBento,
  'category-buttons': CategoryButtons,
  'coming-up': ComingUp,
  'documents-posted': DocumentsPosted,
  'lead-story': LeadStory,
  'latest-list': LatestList,
  briefs: Briefs,
  'beat-sections': BeatSections,
  'briefing-column': BriefingColumn,
  'newsletter-cta': NewsletterCta,
  'meetings-this-week': awaitingData('agenda and meeting sources, M2'),
  'new-businesses': awaitingData('business filings, M2/M6'),
  'real-estate': awaitingData('property sales and permits, M2'),
  events: awaitingData('events sources, M2'),
  'schools-sports': awaitingData('schools sources, later'),
  'weather-strip': awaitingData('NWS, M2 (decision D-M1-3)'),
  'photo-of-the-day': awaitingData('reader submissions, M9'),
  'directory-featured': awaitingData('directory, M6'),
  'directory-categories': awaitingData('directory, M6'),
  'jobs-classifieds': awaitingData('classifieds, later'),
};

/**
 * The order to render the main column: the theme's list, with newsletter-cta guaranteed among
 * the first two modules on mobile. With a full-width top band (homeTop), the band's first module
 * counts as the first, so the CTA is added mobile-only right after it.
 */
export function homeOrder(
  list: readonly HomeModule[],
  top: readonly HomeModule[] = [],
): Array<{ module: HomeModule; mobileOnly: boolean }> {
  const order = list.map((module) => ({ module, mobileOnly: false }));
  const position = [...top, ...list].indexOf('newsletter-cta');
  if (position === 0 || position === 1) return order;
  if (top.length > 0) return order; // the page inserts it into the band (see topBand).
  order.splice(1, 0, { module: 'newsletter-cta', mobileOnly: true });
  return order;
}

/** Whether the top band needs a mobile-only newsletter CTA after its first module. */
export function bandNeedsCta(list: readonly HomeModule[], top: readonly HomeModule[]): boolean {
  if (top.length === 0) return false;
  const position = [...top, ...list].indexOf('newsletter-cta');
  return position !== 0 && position !== 1;
}
