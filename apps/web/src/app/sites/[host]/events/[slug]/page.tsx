import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import type { TownConfig } from '@towncore/config';
import { apDate } from '@towncore/pipeline';
import type { Town } from '@towncore/db';
import { EventCard } from '@/components/events/EventCard';
import listStyles from '@/components/events/events.module.css';
import { siteUrl } from '@/lib/discovery';
import {
  apTimeRange,
  calendarPublisher,
  EVENT_INDEX_MIN_CHARS,
  eventDescription,
  eventIdPrefix,
  eventSlug,
  localIsoDate,
} from '@/lib/events';
import { googleCalendarUrl } from '@/lib/ics';
import { thinUnless } from '@/lib/indexing';
import { StandardPage } from '@/lib/pages';
import { eventJsonLd, JsonLd } from '@/lib/structured-data';
import { requireTown, resolveTown } from '@/lib/town';
import { eventByIdPrefix, upcomingEvents, type EventDetail } from '@/modules/data';
import styles from './event.module.css';

type Props = { params: Promise<{ host: string; slug: string }> };

async function load(town: Town, slug: string) {
  const prefix = eventIdPrefix(slug);
  return prefix ? eventByIdPrefix(town.id, town.name, prefix) : null;
}

/** When the event is over: its end, or the end of its day when it's all day or has no end. */
function isPast(event: EventDetail, timeZone: string, now = new Date()): boolean {
  if (event.end && !event.allDay) return event.end.getTime() < now.getTime();
  // An all-day end is the next midnight (exclusive).
  const last = event.end ? new Date(event.end.getTime() - 1) : event.when;
  return localIsoDate(last, timeZone) < localIsoDate(now, timeZone);
}

/** "Tuesday, Oct. 20", with the year when it isn't this year (AP style). */
function apDay(when: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(when);
  const year = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(d);
  const thisYear = year(when) === year(new Date());
  return `${weekday}, ${apDate(when, timeZone)}${thisYear ? '' : `, ${year(when)}`}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const town = await resolveTown(host);
  const event = town ? await load(town, slug) : null;
  if (!town || !event) return {};
  const tz = town.timezone;
  const text = eventDescription(event.description).join(' ');
  const canonical = `/events/${eventSlug(event.canonical, tz)}`;
  const self = event.canonical.id === event.id;
  // Search lists an event page only when it says more than the list does: the calendar's own
  // description, for an event still to come, on the one copy calendars share (google-safety.md).
  const listable = self && text.length >= EVENT_INDEX_MIN_CHARS && !isPast(event, tz);
  const description = (
    text || `${event.title}, ${apDay(event.when, tz)}, ${apTimeRange(event, tz)}.`
  ).slice(0, 300);
  return {
    title: `${event.title}, ${apDate(event.when, tz)}`,
    description,
    alternates: { canonical },
    robots: thinUnless(town, listable ? 1 : 0, 1),
    openGraph: { title: event.title, description, url: siteUrl(town, canonical) },
  };
}

/**
 * One event from the town's official calendars: when and where in the town's time and AP style,
 * the calendar's own description credited to it, a link to its page, and "Add to calendar".
 */
export default async function EventPage({ params }: Props) {
  const town = await requireTown(params);
  const { slug } = await params;
  const event = await load(town, slug);
  if (!event) notFound();
  const tz = town.timezone;
  const ownSlug = eventSlug(event, tz);
  // A calendar that edited the title: the old address goes to the new one.
  if (ownSlug !== slug) permanentRedirect(`/events/${ownSlug}`);

  const path = `/events/${ownSlug}`;
  const paragraphs = eventDescription(event.description);
  const place = [event.venue, event.street].filter(Boolean).join(', ');
  const config = town.config as Partial<TownConfig>;
  const publisher = calendarPublisher(config.agencies, event.source);
  const government = publisher && !publisher.includes('.') ? publisher : null;
  const past = isPast(event, tz);
  const calendar = {
    id: event.id,
    title: event.title,
    start: event.when,
    end: event.end,
    allDay: event.allDay,
    location: place || null,
    description: paragraphs.join('\n\n') || null,
    pageUrl: siteUrl(town, path),
  };
  const more = (await upcomingEvents(town.id, town.name, 14, 4, true))
    .filter((e) => e.id !== event.id && e.title !== event.title)
    .slice(0, 3);

  return (
    <StandardPage town={town}>
      <JsonLd
        data={eventJsonLd(
          town,
          {
            path,
            title: event.title,
            when: event.when,
            end: event.end,
            allDay: event.allDay,
            venue: event.venue,
            street: event.street,
            description: paragraphs.join('\n\n') || null,
            officialUrl: event.url,
            organizer: government,
          },
          tz,
        )}
      />
      <p className={`meta ${styles.back}`}>
        <Link href="/events">Events</Link>
      </p>
      <article className={styles.event} data-testid="event-detail">
        <header className={styles.header}>
          <span className={listStyles.tile} aria-hidden="true">
            <span className={listStyles.month}>
              {new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(
                event.when,
              )}
            </span>
            <span className={listStyles.day}>
              {new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(
                event.when,
              )}
            </span>
            <span className={listStyles.weekday}>
              {new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
                event.when,
              )}
            </span>
          </span>
          <h1 className={styles.title}>{event.title}</h1>
        </header>
        {past ? (
          <p className={styles.past} data-testid="event-past">
            This event has passed.
          </p>
        ) : null}
        <dl className={styles.facts}>
          <div>
            <dt>When</dt>
            <dd data-testid="event-when">
              <time dateTime={event.when.toISOString()}>{apDay(event.when, tz)}</time>
              <br />
              {apTimeRange(event, tz)}
            </dd>
          </div>
          {place ? (
            <div>
              <dt>Where</dt>
              <dd data-testid="event-where">
                {event.venue ? <span className={styles.venue}>{event.venue}</span> : null}
                {event.venue && event.street ? <br /> : null}
                {event.street}
              </dd>
            </div>
          ) : null}
        </dl>
        {past ? null : (
          <p className={styles.actions}>
            <a
              className="button"
              href={`${path}/ics`}
              download
              data-testid="add-to-calendar"
              rel="nofollow"
            >
              Add to calendar
            </a>
            <a
              className={styles.secondary}
              href={googleCalendarUrl(calendar, tz)}
              rel="nofollow noopener"
              data-testid="google-calendar"
            >
              Google Calendar
            </a>
          </p>
        )}
        {paragraphs.length ? (
          <section className={styles.description} aria-label="About this event">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ) : null}
        <p className="meta" data-testid="event-source">
          {publisher ? <>From the {publisher} calendar. </> : null}
          {event.url ? (
            <a href={event.url} rel="nofollow noopener" data-testid="event-official-link">
              The official listing
            </a>
          ) : null}
        </p>
      </article>
      {more.length ? (
        <section aria-labelledby="more-events" className={styles.more}>
          <h2 id="more-events" className={styles.moreTitle}>
            More coming up
          </h2>
          <ul className={listStyles.list}>
            {more.map((e) => (
              <li key={e.id}>
                <EventCard event={{ ...e, href: `/events/${eventSlug(e, tz)}` }} timeZone={tz} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </StandardPage>
  );
}
