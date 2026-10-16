import type { Metadata } from 'next';
import { apDate } from '@towncore/pipeline';
import { EventCard, type EventCardData } from '@/components/events/EventCard';
import styles from '@/components/events/events.module.css';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { upcomingEvents, upcomingMeetings } from '@/modules/data';

export const metadata: Metadata = { title: 'Events', alternates: { canonical: '/events' } };

const DAYS = 30;

/**
 * The Events tab: the town's official event calendars and its public meetings for the next 30
 * days, as cards grouped by day, each linking to the city's own page.
 */
export default async function EventsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const [events, meetings] = await Promise.all([
    upcomingEvents(town.id, town.name, DAYS, 200),
    upcomingMeetings(town.id, DAYS, 60),
  ]);
  const all: EventCardData[] = [
    ...events,
    ...meetings.map((m) => ({
      id: m.id,
      title: m.title,
      when: m.when,
      end: null,
      allDay: false,
      venue: m.where,
      street: null,
      url: m.url,
      tag: 'Public meeting',
    })),
  ].sort((a, b) => a.when.getTime() - b.when.getTime());
  const dayLabel = (d: Date) =>
    `${new Intl.DateTimeFormat('en-US', { timeZone: town.timezone, weekday: 'long' }).format(d)}, ${apDate(d, town.timezone)}`;
  const days = new Map<string, EventCardData[]>();
  for (const e of all) {
    const label = dayLabel(e.when);
    days.set(label, [...(days.get(label) ?? []), e]);
  }
  return (
    <StandardPage town={town}>
      <LargeTitle title="Events" as="h1" always />
      <p className="muted">
        Events and public meetings on the {town.name} city calendars for the next {DAYS} days. Each
        links to the city&apos;s page for details.
      </p>
      {days.size === 0 ? (
        <p data-testid="events-empty">Nothing is on the city calendars for the next {DAYS} days.</p>
      ) : (
        [...days].map(([day, list]) => (
          <section key={day} aria-label={day}>
            <h2 className={styles.dayHeading}>{day}</h2>
            <ul className={styles.list}>
              {list.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} timeZone={town.timezone} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </StandardPage>
  );
}
