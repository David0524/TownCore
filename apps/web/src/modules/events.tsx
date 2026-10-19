import { SectionHeader } from '@/components/news/SectionHeader';
import { EventCard } from '@/components/events/EventCard';
import styles from '@/components/events/events.module.css';
import { eventSlug } from '@/lib/events';
import { upcomingEvents } from './data';
import type { HomeModuleComponent } from './types';

/**
 * Upcoming events from the town's official calendars (owner's request, after
 * bocatownsquare.com): the next five, a recurring program once, each a card linking to its event
 * page. Hidden when the town has no events source or nothing is coming up.
 */
export const UpcomingEvents: HomeModuleComponent = async ({ town }) => {
  const events = await upcomingEvents(town.id, town.name, 14, 5, true);
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="events-h" data-module="events">
      <SectionHeader title="Upcoming events" href="/events" more="See all" id="events-h" />
      <ul className={styles.list}>
        {events.map((e) => (
          <li key={e.id}>
            <EventCard
              event={{ ...e, href: `/events/${eventSlug(e, town.timezone)}` }}
              timeZone={town.timezone}
            />
          </li>
        ))}
      </ul>
      <p className="meta">From the city&apos;s event calendars.</p>
    </section>
  );
};
