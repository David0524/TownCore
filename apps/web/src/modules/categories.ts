import { cache } from 'react';
import { beatCategory, categoryColors, type Category } from '@towncore/config';
import { categoryCounts } from '@towncore/directory';
import type { Town } from '@towncore/db';
import { db } from '@/lib/db';
import { directoryPath } from '@/lib/directory';
import { beatCounts, townGames, upcomingEvents, upcomingMeetings } from './data';

// Reader categories (docs/plans/M4b.md, D-M4b-4): News, Events, Dining, Things to do,
// Businesses, Homes, Schools and Sports. Beats stay the editorial unit; a category is a reader-facing
// grouping that appears only once it has content or a directory behind it, so no empty fronts.

export type ReaderCategory = {
  key: Category;
  name: string;
  href: string;
  color: string;
  /** "12 this week", "1,979 listed". */
  count: string;
};

const n = (value: number) => value.toLocaleString('en-US');

export const readerCategories = cache(async (town: Town): Promise<ReaderCategory[]> => {
  const now = Date.now();
  const [beats, meetings, events, listings, games] = await Promise.all([
    beatCounts(town.id),
    upcomingMeetings(town.id, 7, 50),
    upcomingEvents(town.id, town.name, 7, 200),
    categoryCounts(db(), town.id),
    townGames(town.id, new Date(now - 14 * 86_400_000), new Date(now + 14 * 86_400_000)),
  ]);
  const newsCount = [...beats]
    .filter(([beat]) => (beatCategory[beat] ?? 'news') === 'news' || beat === 'business')
    .reduce((sum, [, count]) => sum + count, 0);
  const food = listings.filter((c) => c.category.group === 'food');
  const foodCount = food.reduce((sum, c) => sum + c.count, 0);
  const allListed = listings.reduce((sum, c) => sum + c.count, 0);
  const schools = beats.get('schools') ?? 0;
  const out: ReaderCategory[] = [];
  if (newsCount > 0)
    out.push({
      key: 'news',
      name: 'News',
      href: '/news',
      color: categoryColors.news,
      count: `${n(newsCount)} this week`,
    });
  if (meetings.length + events.length > 0)
    out.push({
      key: 'events',
      name: 'Events',
      href: '/events',
      color: categoryColors.events,
      count: `${n(meetings.length + events.length)} this week`,
    });
  if (foodCount > 0) {
    const first = food.find((c) => c.category.slug === 'restaurants') ?? food[0]!;
    out.push({
      key: 'dining',
      name: 'Dining',
      href: directoryPath(first.category.slug),
      color: categoryColors.dining,
      count: `${n(foodCount)} places`,
    });
  }
  if (allListed > 0)
    out.push({
      key: 'business',
      name: 'Businesses',
      href: directoryPath(),
      color: categoryColors.business,
      count: `${n(allListed)} listed`,
    });
  if (schools > 0)
    out.push({
      key: 'schools',
      name: 'Schools',
      href: '/beat/schools',
      color: categoryColors.schools,
      count: `${n(schools)} this week`,
    });
  if (games.length > 0) {
    const thisWeek = games.filter((g) => Math.abs(g.when.getTime() - now) < 7 * 86_400_000).length;
    out.push({
      key: 'sports',
      name: 'Sports',
      href: '/sports',
      color: categoryColors.sports,
      count: `${n(thisWeek || games.length)} ${thisWeek ? 'games this week' : 'games'}`,
    });
  }
  return out;
});
