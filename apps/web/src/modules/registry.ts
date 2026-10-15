import type { HomeModule } from '@towncore/config';
import {
  BeatSections,
  BriefingColumn,
  LatestList,
  LeadStory,
  NewsletterCta,
  TodayBento,
} from './news';
import type { HomeModuleComponent } from './types';

// Modules whose data arrives in a later milestone. They render nothing until then, exactly
// like a module with no data today (CLAUDE.md §11a-2: modules hide when empty).
const awaitingData =
  (_reason: string): HomeModuleComponent =>
  async () =>
    null;

// One component per module in the theme schema; the Record type fails the build on a gap.
export const homeModules: Record<HomeModule, HomeModuleComponent> = {
  'today-bento': TodayBento,
  'lead-story': LeadStory,
  'latest-list': LatestList,
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
 * The order to render: the theme's list, with newsletter-cta guaranteed among the first two on
 * mobile. If the theme doesn't place it there, it's added at position 2 for mobile only.
 */
export function homeOrder(
  list: readonly HomeModule[],
): Array<{ module: HomeModule; mobileOnly: boolean }> {
  const order = list.map((module) => ({ module, mobileOnly: false }));
  if (list.indexOf('newsletter-cta') === 0 || list.indexOf('newsletter-cta') === 1) return order;
  order.splice(1, 0, { module: 'newsletter-cta', mobileOnly: true });
  return order;
}
