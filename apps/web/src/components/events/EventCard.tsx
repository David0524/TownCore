import Link from 'next/link';
import styles from './events.module.css';

export type EventCardData = {
  id: string;
  title: string;
  when: Date;
  end: Date | null;
  allDay: boolean;
  venue: string | null;
  street: string | null;
  url: string | null;
  /** Our own page for the event (/events/<slug>); the card links there instead of `url`. */
  href?: string | null;
  /** A small tag over the title, e.g. "Public meeting". */
  tag?: string | null;
};

const part = (d: Date, timeZone: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone, ...o }).format(d);

/** "6 PM – 7:30 PM", "All day". */
export function eventTimes(e: Pick<EventCardData, 'when' | 'end' | 'allDay'>, timeZone: string) {
  if (e.allDay) return 'All day';
  const t = (d: Date) =>
    part(d, timeZone, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  return e.end && e.end.getTime() > e.when.getTime() ? `${t(e.when)} – ${t(e.end)}` : t(e.when);
}

/**
 * One event (from bocatownsquare.com's design, owner's request): a date tile in the events
 * color (month, day, weekday), the title linking to the official page, then the time and the
 * place with small icons. The whole card is the link: our event page when there is one, else
 * the official page.
 */
export function EventCard({ event, timeZone }: { event: EventCardData; timeZone: string }) {
  const body = (
    <>
      <span className={styles.tile} aria-hidden="true">
        <span className={styles.month}>{part(event.when, timeZone, { month: 'short' })}</span>
        <span className={styles.day}>{part(event.when, timeZone, { day: 'numeric' })}</span>
        <span className={styles.weekday}>{part(event.when, timeZone, { weekday: 'short' })}</span>
      </span>
      <span className={styles.info}>
        {event.tag ? <span className={styles.tag}>{event.tag}</span> : null}
        <span className={styles.title}>{event.title}</span>
        <span className={styles.line}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.icon}>
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.5V8l2.5 1.5" />
          </svg>
          <span className="sr-only">
            {part(event.when, timeZone, { weekday: 'long', month: 'long', day: 'numeric' })},{' '}
          </span>
          {eventTimes(event, timeZone)}
        </span>
        {event.venue || event.street ? (
          <span className={styles.line}>
            <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.icon}>
              <path d="M8 14.5s4.75-4.2 4.75-8A4.75 4.75 0 0 0 3.25 6.5c0 3.8 4.75 8 4.75 8Z" />
              <circle cx="8" cy="6.5" r="1.75" />
            </svg>
            <span className={styles.place}>
              {[event.venue, event.street].filter(Boolean).join(', ')}
            </span>
          </span>
        ) : null}
      </span>
      {event.href || event.url ? (
        <svg viewBox="0 0 8 14" aria-hidden="true" className={styles.chevron}>
          <path d="M1.5 1.5 6.5 7l-5 5.5" />
        </svg>
      ) : null}
    </>
  );
  if (event.href)
    return (
      <Link href={event.href} className={styles.card} data-testid="event-card">
        {body}
      </Link>
    );
  return event.url ? (
    <a href={event.url} rel="nofollow noopener" className={styles.card} data-testid="event-card">
      {body}
    </a>
  ) : (
    <div className={styles.card} data-testid="event-card">
      {body}
    </div>
  );
}
