import { beats, type TownConfig } from '@towncore/config';
import { listPublishedGuides } from '@towncore/db';
import { apDate } from '@towncore/pipeline';
import Link from 'next/link';
import { SectionHeader } from '@/components/news/SectionHeader';
import { clockTime } from '@/components/weather/format';
import { db } from '@/lib/db';
import { articlePath } from '@/lib/paths';
import { beatColorVar } from '@/lib/theme';
import { beatCounts, cityPostings, recentArticles, upcomingMeetings } from './data';
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

/** "Good morning, Boca Raton" with the date and when the newsroom last published. */
export const GoodMorning: HomeModuleComponent = async ({ town }) => {
  const now = new Date();
  const newest = (await recentArticles(town.id)).reduce<Date | null>(
    (max, a) => (!max || a.publishedAt > max ? a.publishedAt : max),
    null,
  );
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: town.timezone,
    weekday: 'long',
  }).format(now);
  return (
    <div className={`${styles.greeting} not-phone`} data-module="good-morning">
      <p className={styles.hello}>
        {greeting(now, town.timezone)}, {town.name}
      </p>
      <p className="meta">
        {weekday}, {apDate(now, town.timezone)}
        {newest ? ` · Updated ${clockTime(newest, town.timezone)}` : ''}
      </p>
    </div>
  );
};

/** Hairline buttons for each section with new stories this week: a dot, a name, a count. */
export const CategoryButtons: HomeModuleComponent = async ({ town }) => {
  const counts = await beatCounts(town.id);
  const shown = beats.filter((b) => (counts.get(b.slug) ?? 0) > 0);
  if (shown.length === 0) return null;
  return (
    <nav aria-label="Sections with new stories" data-module="category-buttons">
      <ul className={styles.buttons}>
        {shown.map((beat) => (
          <li key={beat.slug} data-follow-beat={beat.slug}>
            <Link href={`/beat/${beat.slug}`} className={styles.button}>
              <span
                className={styles.dot}
                style={{ background: beatColorVar(beat.slug) }}
                aria-hidden="true"
              />
              <span>{beat.label}</span>
              <span className="meta">{counts.get(beat.slug)} new</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

/** Public meetings on the city calendar in the next 7 days, linking to the city's own page. */
export const ComingUp: HomeModuleComponent = async ({ town }) => {
  const meetings = await upcomingMeetings(town.id);
  if (meetings.length === 0) return null;
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone: town.timezone, weekday: 'short' }).format(d);
  return (
    <section className={styles.coming} aria-labelledby="coming-h" data-module="coming-up">
      <SectionHeader title="Coming up at City Hall" id="coming-h" />
      <ol className={styles.meetings}>
        {meetings.map((m) => (
          <li key={m.id}>
            <span className="meta">
              {day(m.when)}. {apDate(m.when, town.timezone)} · {clockTime(m.when, town.timezone)}
            </span>
            {m.url ? (
              <a href={m.url} rel="nofollow noopener" className={styles.meetingTitle}>
                {m.title}
              </a>
            ) : (
              <span className={styles.meetingTitle}>{m.title}</span>
            )}
            {m.where ? <span className={styles.where}>{m.where}</span> : null}
          </li>
        ))}
      </ol>
      <p className="meta">From the city&apos;s public meeting calendar.</p>
    </section>
  );
};

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
