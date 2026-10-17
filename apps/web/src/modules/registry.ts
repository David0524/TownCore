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
import { CategoryButtons, ComingUp, DocumentsPosted, Essentials, GoodMorning } from './front';
import { DirectoryCategories, DirectoryFeatured, FindAPro, NewNowOpen } from './directory';
import { UpcomingEvents } from './events';
import { DirectoryGrid, QuickLinks } from './explore';
import { PhotoOfTheWeek } from './photo';
import { QuickPoll } from './poll';
import { SchoolsSports } from './sports';
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
  essentials: Essentials,
  'lead-story': LeadStory,
  'latest-list': LatestList,
  briefs: Briefs,
  'beat-sections': BeatSections,
  'briefing-column': BriefingColumn,
  'newsletter-cta': NewsletterCta,
  'meetings-this-week': awaitingData('agenda and meeting sources, M2'),
  'new-businesses': awaitingData('business filings, M2/M6'),
  'real-estate': awaitingData('property sales and permits, M2'),
  events: UpcomingEvents,
  'schools-sports': SchoolsSports,
  'weather-strip': awaitingData('NWS, M2 (decision D-M1-3)'),
  'photo-of-the-day': awaitingData('reader submissions, M9'),
  'photo-of-the-week': PhotoOfTheWeek,
  'quick-poll': QuickPoll,
  'directory-featured': DirectoryFeatured,
  'directory-categories': DirectoryCategories,
  'find-a-pro': FindAPro,
  'new-now-open': NewNowOpen,
  'quick-links': QuickLinks,
  'directory-grid': DirectoryGrid,
  'jobs-classifieds': awaitingData('classifieds, later'),
};

export { bandNeedsCta, homeOrder, SPANNING_MODULES } from './order';
