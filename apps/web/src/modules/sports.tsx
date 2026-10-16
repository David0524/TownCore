import { SectionHeader } from '@/components/news/SectionHeader';
import { EventCard } from '@/components/events/EventCard';
import styles from '@/components/events/events.module.css';
import { gameCard } from '@/components/sports/game';
import { townGames } from './data';
import type { HomeModuleComponent } from './types';

/**
 * `schools-sports` (§11a-2): the town's next games, or this week's finals when none are coming
 * up, as calendar cards linking to the official schedule. Team level only (docs/plans/sports.md).
 * Hidden when the town has no sports source or nothing in the window.
 */
export const SchoolsSports: HomeModuleComponent = async ({ town }) => {
  const now = Date.now();
  const games = await townGames(
    town.id,
    new Date(now - 7 * 86_400_000),
    new Date(now + 7 * 86_400_000),
  );
  const next = games.filter((g) => g.when.getTime() >= now && g.status !== 'final').slice(0, 4);
  const shown =
    next.length > 0
      ? next
      : games
          .filter((g) => g.status === 'final')
          .reverse()
          .slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="sports-h" data-module="schools-sports">
      <SectionHeader
        title={next.length > 0 ? 'Next games' : 'Latest scores'}
        href="/sports"
        more="All sports"
        id="sports-h"
      />
      <ul className={styles.list}>
        {shown.map((g) => (
          <li key={g.id}>
            <EventCard event={gameCard(g)} timeZone={town.timezone} />
          </li>
        ))}
      </ul>
    </section>
  );
};
