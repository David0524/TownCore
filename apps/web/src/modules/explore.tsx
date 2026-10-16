import Link from 'next/link';
import { categoryColors, type FoodColor } from '@towncore/config';
import { categoryCounts } from '@towncore/directory';
import { listPublishedGuides } from '@towncore/db';
import { CategoryIcon, type IconKey } from '@/components/directory/CategoryIcon';
import { SectionHeader } from '@/components/news/SectionHeader';
import { db } from '@/lib/db';
import { directoryPath } from '@/lib/directory';
import { articlePath } from '@/lib/discovery';
import type { HomeModuleComponent } from './types';
import styles from './explore.module.css';

// Ways into the site from the homepage (owner, 2026-10-16, from bocatownsquare.com): the quick
// links bar and the directory grid. Each link appears only when there is something behind it.

const ICONS = {
  store:
    'M4 9l1.5-5h13L20 9M4 9h16M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9M5 11v9h14v-9M10 20v-5h4v5',
  calendar: 'M5 6h14v14H5V6ZM5 10h14M9 4v4M15 4v4M9 14h2M13 14h2M9 17h2',
  dining: 'M7 3v7a2 2 0 0 0 4 0V3M9 10v11M16 21V3c-2 1-3 4-3 7h3',
  palm: 'M12 21c0-5 .5-9 2-12M14 9c-1.5-3-5-4-8-2 3 0 5 1 8 2ZM14 9c1-3 4-5 7-4-3 1-5 2-7 4ZM14 9c3 0 6 2 6 5-2-2-4-3-6-5ZM14 9c-3 0-6 2-7 5 2-2 4-3 7-5ZM8 21h10',
  weather:
    'M8 8a4 4 0 0 1 7.5-1.5M5 4l1 1M12 2v1.5M3 10h1.5M7.5 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.5 1.5A2.8 2.8 0 0 0 7.5 19Z',
} as const;

const Svg = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** The quick-links bar: Businesses, Events, Dining, Things to do, Weather. */
export const QuickLinks: HomeModuleComponent = async ({ town }) => {
  const [counts, guides] = await Promise.all([
    categoryCounts(db(), town.id),
    listPublishedGuides(db(), town.id),
  ]);
  const food =
    counts.find((c) => c.category.slug === 'restaurants') ??
    counts.find((c) => c.category.group === 'food');
  const outdoors = guides.find((g) => /beach|park/i.test(g.headline));
  const links = [
    counts.length > 0 && {
      key: 'business',
      name: 'Businesses',
      sub: 'Local directory',
      href: directoryPath(),
      color: categoryColors.business,
      icon: ICONS.store,
    },
    {
      key: 'events',
      name: 'Events',
      sub: 'What’s happening',
      href: '/events',
      color: categoryColors.events,
      icon: ICONS.calendar,
    },
    food && {
      key: 'dining',
      name: 'Dining',
      sub: 'Where to eat',
      href: directoryPath(food.category.slug),
      color: categoryColors.dining,
      icon: ICONS.dining,
    },
    outdoors && {
      key: 'todo',
      name: 'Things to do',
      sub: 'Beaches and parks',
      href: articlePath(outdoors.slug),
      color: categoryColors.todo,
      icon: ICONS.palm,
    },
    {
      key: 'weather',
      name: 'Weather',
      sub: '7-day forecast',
      href: '/weather',
      color: categoryColors.news,
      icon: ICONS.weather,
    },
  ].filter((l): l is Exclude<typeof l, false | undefined> => Boolean(l));
  return (
    <nav aria-label="Explore" data-module="quick-links" className={styles.quick}>
      <ul className={styles.bar}>
        {links.map((link) => (
          <li key={link.key}>
            <Link href={link.href} className={styles.link}>
              <span
                className={styles.square}
                style={{ '--square': link.color } as React.CSSProperties}
              >
                <Svg d={link.icon} />
              </span>
              <span className={styles.text}>
                <span className={styles.name}>{link.name}</span>
                <span className={styles.sub}>{link.sub}</span>
              </span>
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

const FLAVORS: FoodColor[] = ['ocean', 'saffron', 'basil', 'tomato', 'berry', 'cocoa'];

/**
 * The directory on the homepage: every category with listings as a colored tile with its
 * count, home-service trades rolled into one tile, then the free-listing invitation.
 */
export const DirectoryGrid: HomeModuleComponent = async ({ town }) => {
  const counts = await categoryCounts(db(), town.id);
  if (counts.length === 0) return null;
  const home = counts.filter((c) => c.category.group === 'home');
  const homeTotal = home.reduce((n, c) => n + c.count, 0);
  type Tile = { key: string; name: string; count: number; href: string; icon?: IconKey };
  const tiles: Array<Tile & { category?: (typeof counts)[number]['category'] }> = [];
  for (const group of ['food', 'shops', 'home', 'health', 'services', 'fun'] as const) {
    if (group === 'home') {
      if (homeTotal > 0)
        tiles.push({
          key: 'home',
          name: 'Home services',
          count: homeTotal,
          href: `${directoryPath()}#dir-home`,
          icon: 'tools',
        });
      continue;
    }
    for (const { category, count } of counts.filter((c) => c.category.group === group))
      tiles.push({
        key: category.slug,
        name: category.name,
        count,
        href: directoryPath(category.slug),
        category,
      });
  }
  // Twenty tiles at most (four rows of five): past that, the smallest categories step aside
  // (they're one click away in the full directory).
  while (tiles.length > 20) {
    const smallest = tiles.reduce((min, t, i) => (t.count < tiles[min]!.count ? i : min), 0);
    tiles.splice(smallest, 1);
  }
  return (
    <section aria-labelledby="dir-grid-h" data-module="directory-grid">
      <SectionHeader
        title="Business directory"
        href={directoryPath()}
        more="Browse"
        id="dir-grid-h"
      />
      <ul className={styles.tiles}>
        {tiles.map((tile, i) => {
          const flavor = FLAVORS[i % FLAVORS.length]!;
          return (
            <li key={tile.key}>
              <Link href={tile.href} className={styles.tile}>
                <span
                  className={styles.round}
                  style={
                    {
                      '--tint-bg': `var(--food-${flavor})`,
                      '--tint-ink': `var(--food-${flavor}-ink)`,
                    } as React.CSSProperties
                  }
                >
                  <CategoryIcon category={tile.category} icon={tile.icon} />
                </span>
                <span className={styles.text}>
                  <span className={styles.name}>{tile.name}</span>
                  <span className={styles.sub}>
                    {tile.count.toLocaleString('en-US')}{' '}
                    {tile.count === 1 ? 'business' : 'businesses'}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/advertise#claim" className={styles.add}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.plus}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
        <strong>Free listings for every local business.</strong>
        <span>Add yours</span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </Link>
    </section>
  );
};
