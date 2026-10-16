import type { Metadata } from 'next';
import Link from 'next/link';
import { apDate } from '@towncore/pipeline';
import { EventCard, type EventCardData } from '@/components/events/EventCard';
import styles from '@/components/events/events.module.css';
import places from '@/components/directory/places.module.css';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { gameCard } from '@/components/sports/game';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { townGames, type GameItem } from '@/modules/data';

export const metadata: Metadata = { title: 'Sports', alternates: { canonical: '/sports' } };

const AHEAD = 14;
const BACK = 14;

/**
 * The Sports tab (owner, 2026-10-16: "I do need a sports tab"): the town's teams' games for the
 * next two weeks and the last two weeks' results, from official schedules (docs/plans/sports.md).
 * Team level only: no player is ever named (§7).
 */
export default async function SportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ sport?: string }>;
}) {
  const town = await requireTown(params);
  const { sport } = await searchParams;
  const now = new Date();
  const games = await townGames(
    town.id,
    new Date(now.getTime() - BACK * 86_400_000),
    new Date(now.getTime() + AHEAD * 86_400_000),
  );
  const sports = [...new Set(games.map((g) => g.sport))].sort();
  const shown = sport ? games.filter((g) => g.sport.toLowerCase() === sport.toLowerCase()) : games;
  const upcoming = shown.filter((g) => g.when >= now && g.status !== 'final');
  const results = shown.filter((g) => g.status === 'final').reverse();
  const dayLabel = (d: Date) =>
    `${new Intl.DateTimeFormat('en-US', { timeZone: town.timezone, weekday: 'long' }).format(d)}, ${apDate(d, town.timezone)}`;
  const byDay = (list: GameItem[]) => {
    const days = new Map<string, GameItem[]>();
    for (const g of list) days.set(dayLabel(g.when), [...(days.get(dayLabel(g.when)) ?? []), g]);
    return [...days];
  };
  const listOf = (list: GameItem[]) =>
    byDay(list).map(([day, items]) => (
      <section key={day} aria-label={day}>
        <h3 className={styles.dayHeading}>{day}</h3>
        <ul className={styles.list}>
          {items.map((g) => (
            <li key={g.id}>
              <EventCard event={gameCard(g)} timeZone={town.timezone} />
            </li>
          ))}
        </ul>
      </section>
    ));
  return (
    <StandardPage town={town}>
      <LargeTitle title="Sports" as="h1" always />
      <p className="muted">
        {town.name} teams&apos; games for the next two weeks and recent results, from official
        schedules. Each links to the official schedule or results page.
      </p>
      {sports.length > 1 ? (
        <nav aria-label="Sports">
          <ul className={places.chips} data-testid="sport-chips">
            <li>
              <Link
                href="/sports"
                className={places.chip}
                aria-current={!sport ? 'true' : undefined}
              >
                All
              </Link>
            </li>
            {sports.map((s) => (
              <li key={s}>
                <Link
                  href={`/sports?sport=${encodeURIComponent(s.toLowerCase())}`}
                  className={places.chip}
                  aria-current={sport?.toLowerCase() === s.toLowerCase() ? 'true' : undefined}
                >
                  {s}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {shown.length === 0 ? (
        <p data-testid="sports-empty">
          No games are on the schedules we follow for the next two weeks. Schedules for {town.name}
          {"'"}s teams appear here as they&apos;re posted.
        </p>
      ) : null}
      {upcoming.length > 0 ? (
        <section aria-labelledby="coming-up" data-testid="sports-upcoming">
          <h2 id="coming-up">Coming up</h2>
          {listOf(upcoming)}
        </section>
      ) : null}
      {results.length > 0 ? (
        <section aria-labelledby="results" data-testid="sports-results">
          <h2 id="results">Recent results</h2>
          {listOf(results)}
        </section>
      ) : null}
    </StandardPage>
  );
}
