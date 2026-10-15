import Link from 'next/link';
import { NewsletterForm } from '@/components/NewsletterForm';
import { SectionHeader } from '@/components/news/SectionHeader';
import { StoryBlock } from '@/components/news/StoryBlock';
import { TypographicCard } from '@/components/news/TypographicCard';
import { WeatherTile } from '@/components/weather/WeatherTile';
import { newsletterOpen } from '@/lib/newsletter';
import { beats } from '@towncore/config';
import type { Article } from '@towncore/db';
import { formatTownDate } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import { SunsetTile } from '@/components/weather/SunsetTile';
import { townSunset } from '@/lib/sun';
import {
  frontSplit,
  pickLead,
  recentArticles,
  roundupFigure,
  townPoint,
  townWeather,
} from './data';
import type { HomeModuleComponent } from './types';
import styles from './modules.module.css';

export const LeadStory: HomeModuleComponent = async ({ town, theme }) => {
  const lead = pickLead(await recentArticles(town.id));
  if (!lead) return null;
  const figure = await roundupFigure(lead);
  return (
    <section className={styles.module} data-module="lead-story">
      <StoryBlock
        story={lead}
        town={town}
        variant="lead"
        as="h2"
        visual={
          <TypographicCard
            theme={theme}
            beat={lead.beat}
            headline={lead.headline}
            figure={figure}
          />
        }
      />
    </section>
  );
};

/** The Today tile: weather now (docs/plans/M4b.md). Hidden when the town has no NWS data. */
export const TodayBento: HomeModuleComponent = async ({ town, modules }) => {
  const [weather, point, articles] = await Promise.all([
    townWeather(town.id),
    townPoint(town.id),
    recentArticles(town.id),
  ]);
  const sunset = point ? townSunset(new Date(), town.timezone, point[0], point[1]) : null;
  const { also } = frontSplit(articles, modules);
  if (!weather && !sunset && also.length === 0) return null;
  return (
    <div className={styles.today} data-module="today-bento">
      {weather ? <WeatherTile town={town} weather={weather} /> : null}
      {sunset ? <SunsetTile town={town} sunset={sunset} /> : null}
      {also.length > 0 ? (
        <section aria-labelledby="also-h">
          <h2 id="also-h" className={`meta ${styles.alsoHeading}`}>
            Also today
          </h2>
          <ul className={styles.list}>
            {also.map((article) => (
              <li key={article.id}>
                <StoryBlock story={article} town={town} variant="list" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

const INFEED_EVERY = 6;

export const LatestList: HomeModuleComponent = async ({ town, modules }) => {
  const items = frontSplit(await recentArticles(town.id), modules).rest.slice(0, 12);
  if (items.length === 0) return null;

  // home.infeed every ~6 items, and once at the end of shorter lists.
  const rows: React.ReactNode[] = [];
  items.forEach((article, i) => {
    rows.push(
      <li key={article.id}>
        <StoryBlock story={article} town={town} variant="brief" />
      </li>,
    );
    const position = i + 1;
    if (
      position % INFEED_EVERY === 0 ||
      (position === items.length && items.length < INFEED_EVERY && items.length >= 3)
    ) {
      rows.push(
        <li key={`infeed-${position}`}>
          <Slot town={town} name="home.infeed" />
        </li>,
      );
    }
  });

  return (
    <section className={styles.module} data-module="latest-list">
      <SectionHeader title="Latest" />
      <ul className={styles.list}>{rows}</ul>
    </section>
  );
};

/** Newsletter-style dated list; good for smaller towns (CLAUDE.md §11a-2). */
export const BriefingColumn: HomeModuleComponent = async ({ town }) => {
  const articles = (await recentArticles(town.id)).slice(0, 8);
  if (articles.length === 0) return null;
  const byDay = new Map<string, Article[]>();
  for (const article of articles) {
    const day = formatTownDate(article.publishedAt!, town);
    byDay.set(day, [...(byDay.get(day) ?? []), article]);
  }
  return (
    <section className={`${styles.module} ${styles.briefing}`} data-module="briefing-column">
      <SectionHeader title="The briefing" />
      {[...byDay].map(([day, dayArticles]) => (
        <div key={day}>
          <p className={`meta ${styles.day}`}>{day}</p>
          <ul className={styles.list}>
            {dayArticles.map((article) => (
              <li key={article.id}>
                <StoryBlock story={article} town={town} variant="list" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

export const BeatSections: HomeModuleComponent = async ({ town, modules }) => {
  const all = await recentArticles(town.id);
  const lead = modules.includes('lead-story') ? pickLead(all) : undefined;
  const articles = all.filter((a) => a.id !== lead?.id);
  const sections = beats
    .map((beat) => ({ beat, items: articles.filter((a) => a.beat === beat.slug).slice(0, 3) }))
    .filter((s) => s.items.length > 0);
  if (sections.length === 0) return null;
  return (
    <div data-module="beat-sections">
      {sections.map(({ beat, items }) => (
        <section key={beat.slug} className={styles.module}>
          <SectionHeader title={beat.label} href={`/beat/${beat.slug}`} />
          <ul className={styles.list}>
            {items.map((article) => (
              <li key={article.id}>
                <StoryBlock story={article} town={town} variant="list" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

/**
 * The signup box (Mail-5). Until the town's mail domain can send bulk mail it keeps the
 * "launching soon" line with no email field (D-M1-1).
 */
export const NewsletterCta: HomeModuleComponent = async ({ town }) => (
  <section className={`${styles.module} ${styles.cta}`} data-module="newsletter-cta">
    <h2>Get {town.name} news every morning</h2>
    {(await newsletterOpen(town)) ? (
      <>
        <p>
          Our free daily newsletter, written from public records.{' '}
          <Link href="/methods">How we report</Link>.
        </p>
        <NewsletterForm source="/" id="cta" />
      </>
    ) : (
      <p>
        Our free daily newsletter, written from public records, is launching soon.{' '}
        <Link href="/methods">How we report</Link>.
      </p>
    )}
  </section>
);
