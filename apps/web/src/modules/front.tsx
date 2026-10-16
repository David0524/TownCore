import { townShortName, type TownConfig } from '@towncore/config';
import { listPublishedGuides } from '@towncore/db';
import { apDate } from '@towncore/pipeline';
import Link from 'next/link';
import { SectionHeader } from '@/components/news/SectionHeader';
import { clockTime } from '@/components/weather/format';
import { db } from '@/lib/db';
import { articlePath } from '@/lib/paths';
import type { Town } from '@towncore/db';
import { readerCategories } from './categories';
import { cityPostings, upcomingMeetings } from './data';
import type { HomeModuleComponent } from './types';
import styles from './front.module.css';

// Front-page modules from docs/plans/M4b.md (revisions 2–4): the greeting, the section buttons
// with live counts, and the meetings coming up. Each hides itself when it has nothing to show.

export function greeting(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now),
  );
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * "Good morning, Boca" (the town's short name) with today's date. No "Updated" time: the newest
 * story can be days old, and a bare clock time beside "Good morning" read as today.
 */
export const GoodMorning: HomeModuleComponent = async ({ town }) => {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: town.timezone,
    weekday: 'long',
  }).format(now);
  return (
    <div className={`${styles.greeting} not-phone`} data-module="good-morning">
      <p className={styles.hello}>
        {greeting(now, town.timezone)}, {townShortName(town.config as TownConfig)}
      </p>
      <p className="meta">
        {weekday}, {apDate(now, town.timezone)}
      </p>
    </div>
  );
};

/**
 * The reader categories as cards (canvas "Homepage": Explore), each with its color, what's in
 * it and an arrow; on phones a two-column "Explore" grid. Only categories with content show
 * (D-M4b-4).
 */
export const CategoryButtons: HomeModuleComponent = async ({ town }) => {
  const categories = await readerCategories(town);
  if (categories.length === 0) return null;
  const short = townShortName(town.config as TownConfig);
  return (
    <nav aria-label={`Explore ${short}`} data-module="category-buttons">
      <h2 className={`${styles.exploreTitle} phone-only`}>Explore {short}</h2>
      <ul className={styles.buttons}>
        {categories.map((c) => (
          <li key={c.key} data-category={c.key}>
            <Link href={c.href} className={styles.button}>
              <span className={styles.buttonTop}>
                <span className={styles.dot} style={{ background: c.color }} aria-hidden="true" />
                <span className={`meta ${styles.count}`}>{c.count}</span>
              </span>
              <span className={styles.buttonName}>
                {c.name}
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
              </span>
              <span className={`${styles.sub} phone-only`}>{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

/** Phones: the categories as filled capsules in one row under the search field. */
export async function CategoryCapsules({ town }: { town: Town }) {
  const categories = await readerCategories(town);
  if (categories.length === 0) return null;
  return (
    <nav aria-label="Categories" className="phone-only" data-testid="category-capsules">
      <ul className={styles.capsules}>
        {categories.map((c) => (
          <li key={c.key}>
            <Link href={c.href} className={styles.capsule}>
              <span className={styles.square} style={{ background: c.color }} aria-hidden="true" />
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Public meetings on the city calendar in the next 7 days (canvas "Homepage": City Hall this
 * week): the day, the meeting linking to the city's own page, and its time and room.
 */
export const ComingUp: HomeModuleComponent = async ({ town }) => {
  const meetings = await upcomingMeetings(town.id);
  if (meetings.length === 0) return null;
  const part = (d: Date, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: town.timezone, ...o }).format(d);
  const day = (d: Date) => `${part(d, { weekday: 'short' })} ${part(d, { day: 'numeric' })}`;
  return (
    <section className={styles.coming} aria-labelledby="coming-h" data-module="coming-up">
      <SectionHeader title="City Hall this week" href="/events" more="Calendar" id="coming-h" />
      <ol className={`${styles.meetings} ${styles.dated}`}>
        {meetings.map((m) => (
          <li key={m.id}>
            <span className={`meta ${styles.day}`}>{day(m.when)}</span>
            <span className={styles.meetingBody}>
              {m.url ? (
                <a href={m.url} rel="nofollow noopener" className={styles.meetingTitle}>
                  {m.title}
                </a>
              ) : (
                <span className={styles.meetingTitle}>{m.title}</span>
              )}
              <span className={styles.where}>
                {[clockTime(m.when, town.timezone), m.where ? placeName(m.where) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="meta">From the city&apos;s public meeting calendar.</p>
    </section>
  );
};

/** "City Hall - 1st Floor Conference Room #1 - 201 W Palmetto Park Road …" → its first part. */
function placeName(where: string): string {
  return where.split(/\s[-–]\s/)[0]!.trim();
}

/**
 * Essentials (M4 PR F): quick links to the town's evergreen guides, in the order its config
 * lists the topics (the most-asked first), linking to the full list.
 */
export const Essentials: HomeModuleComponent = async ({ town }) => {
  const order: string[] = ((town.config as TownConfig).guides ?? []).map((g) => g.topic);
  const guides = (await listPublishedGuides(db(), town.id))
    .filter((g) => g.guideTopic && order.includes(g.guideTopic))
    .sort((a, b) => order.indexOf(a.guideTopic!) - order.indexOf(b.guideTopic!))
    .slice(0, 6);
  if (guides.length === 0) return null;
  return (
    <section className={styles.coming} aria-labelledby="essentials-h" data-module="essentials">
      <SectionHeader title="Essentials" href="/guides" id="essentials-h" />
      <ul className={styles.meetings}>
        {guides.map((g) => (
          <li key={g.id}>
            <Link href={articlePath(g.slug, g.kind)} className={styles.meetingTitle}>
              {g.headline}
            </Link>
          </li>
        ))}
      </ul>
      <p className="meta">
        <Link href="/guides">All guides</Link>
      </p>
    </section>
  );
};

/** The city's own recent releases ("Posted by the city"), linked to the city's pages. */
export const DocumentsPosted: HomeModuleComponent = async ({ town }) => {
  const posts = await cityPostings(town.id);
  if (posts.length === 0) return null;
  return (
    <section className={styles.coming} aria-labelledby="posted-h" data-module="documents-posted">
      <SectionHeader title="Posted by the city" id="posted-h" />
      <ol className={styles.meetings}>
        {posts.map((p) => (
          <li key={p.id}>
            <span className="meta">{apDate(p.at, town.timezone)}</span>
            <a href={p.url} rel="nofollow noopener" className={styles.meetingTitle}>
              {p.title}
            </a>
          </li>
        ))}
      </ol>
      <p className="meta">Links go to the city&apos;s website.</p>
    </section>
  );
};
