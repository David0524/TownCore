import Link from 'next/link';
import { EnvelopeIcon } from '@/components/phone/icons';
import { NewsletterForm } from '@/components/NewsletterForm';
import { SectionHeader } from '@/components/news/SectionHeader';
import { StoryBlock } from '@/components/news/StoryBlock';
import { TopStoriesRow } from '@/components/news/StoryCards';
import { ArticleVisual } from '@/components/visuals/ArticleVisual';
import { StoryThumb } from '@/components/visuals/StoryThumb';
import { WeatherTile } from '@/components/weather/WeatherTile';
import { newsletterOpen } from '@/lib/newsletter';
import { beats, townShortName, tropicsLine, type TownConfig } from '@towncore/config';
import { townVariant, type Article } from '@towncore/db';
import { db } from '@/lib/db';
import { formatTownDate } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import { SunsetTile } from '@/components/weather/SunsetTile';
import { BeachTiles } from '@/components/weather/BeachTiles';
import { townSunset } from '@/lib/sun';
import {
  frontSplit,
  pickLead,
  recentArticles,
  roundupFigure,
  townPoint,
  townTropics,
  townWeather,
} from './data';
import type { HomeModuleComponent } from './types';
import styles from './modules.module.css';

export const LeadStory: HomeModuleComponent = async ({ town, theme }) => {
  const articles = await recentArticles(town.id);
  const lead = pickLead(articles);
  if (!lead) return null;
  // Phones: the next stories as a row of picture cards under the lead, so there's always more
  // in view (owner, 2026-10-16). "Also today" steps aside there, since the row covers it.
  const next = articles.filter((a) => a.id !== lead.id && a.kind !== 'guide').slice(0, 6);
  const figure = await roundupFigure(lead);
  return (
    <section className={styles.module} data-module="lead-story">
      <StoryBlock
        story={lead}
        town={town}
        variant="lead"
        as="h2"
        visual={<ArticleVisual town={town} theme={theme} article={lead} figure={figure} cover />}
      />
      <div className="phone-only">
        <TopStoriesRow town={town} theme={theme} stories={next} />
      </div>
    </section>
  );
};

/** The Today tile: weather now (docs/plans/M4b.md). Hidden when the town has no NWS data. */
export const TodayBento: HomeModuleComponent = async ({ town, theme, modules }) => {
  const [weather, point, articles, tropics] = await Promise.all([
    townWeather(town.id),
    townPoint(town.id),
    recentArticles(town.id),
    townTropics(town.state),
  ]);
  const sunset = point ? townSunset(new Date(), town.timezone, point[0], point[1]) : null;
  const { also } = frontSplit(articles, modules);
  const b = weather?.kind === 'snapshot' ? weather.snapshot.beach : undefined;
  const beach = b && (b.surf || b.water || b.tides || b.uv) ? b : null;
  const wind = weather?.kind === 'snapshot' ? weather.snapshot.now : null;
  if (!weather && !sunset && also.length === 0) return null;
  return (
    <div className={styles.today} data-module="today-bento">
      {/* On phones the conditions move above the top story (canvas HomePhone), so weather is
          above the fold; "Also today" stays where it is. */}
      <div className={styles.conditions}>
        {weather ? (
          <WeatherTile town={town} weather={weather} tropics={tropics && tropicsLine(tropics)} />
        ) : null}
        {/* Coastal towns: the beach tile beside sunset; others: sunset alone. */}
        {beach ? (
          <BeachTiles town={town} beach={beach} sunset={sunset} wind={wind} />
        ) : sunset ? (
          <SunsetTile town={town} sunset={sunset} wind={wind} />
        ) : null}
      </div>
      {also.length > 0 ? (
        <section aria-labelledby="also-h" className="not-phone">
          <h2 id="also-h" className={`meta ${styles.alsoHeading}`}>
            Also today
          </h2>
          <ul className={styles.list}>
            {also.map((article) => (
              <li key={article.id}>
                <StoryBlock
                  story={article}
                  town={town}
                  variant="today"
                  visual={<StoryThumb town={town} theme={theme} article={article} />}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

const INFEED_EVERY = 6;

export const LatestList: HomeModuleComponent = async ({ town, theme, modules }) => {
  const items = frontSplit(await recentArticles(town.id), modules).rest.slice(0, 12);
  if (items.length === 0) return null;

  // home.infeed every ~6 items, and once at the end of shorter lists.
  const rows: React.ReactNode[] = [];
  items.forEach((article, i) => {
    rows.push(
      <li key={article.id}>
        <StoryBlock
          story={article}
          town={town}
          variant="brief"
          visual={<StoryThumb town={town} theme={theme} article={article} />}
        />
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
      <SectionHeader title="Latest" href="/news" more="All news" />
      <ul className={styles.list}>{rows}</ul>
    </section>
  );
};

/** Short headlines after the lead and Today (heritage's right-hand column). */
export const Briefs: HomeModuleComponent = async ({ town, modules }) => {
  const items = frontSplit(await recentArticles(town.id), modules).rest.slice(0, 6);
  if (items.length === 0) return null;
  return (
    <section
      className={`${styles.module} ${styles.briefs}`}
      data-module="briefs"
      aria-labelledby="briefs-h"
    >
      <SectionHeader title="Briefs" id="briefs-h" />
      <ul className={styles.list}>
        {items.map((article) => (
          <li key={article.id}>
            <StoryBlock story={article} town={town} variant="list" />
          </li>
        ))}
      </ul>
    </section>
  );
};

/** Newsletter-style dated list; good for smaller towns (CLAUDE.md §11a-2). */
export const BriefingColumn: HomeModuleComponent = async ({ town, theme }) => {
  const articles = (await recentArticles(town.id)).slice(0, 8);
  if (articles.length === 0) return null;
  const byDay = new Map<string, Article[]>();
  for (const article of articles) {
    const day = formatTownDate(article.publishedAt!, town);
    byDay.set(day, [...(byDay.get(day) ?? []), article]);
  }
  return (
    <section className={`${styles.module} ${styles.briefing}`} data-module="briefing-column">
      <SectionHeader
        title={theme.family === 'community' ? `Today in ${town.name}` : 'The briefing'}
      />
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
    <div data-module="beat-sections" className={styles.beatSections}>
      {sections.map(({ beat, items }) => (
        <section key={beat.slug} className={styles.module} data-follow-beat={beat.slug}>
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
export const NewsletterCta: HomeModuleComponent = async ({ town, placement = 'home' }) => {
  const config = town.config as TownConfig;
  // Heading copy is an experiment per town or cohort (owner, 2026-10-17), never per reader.
  const variant = await townVariant(db(), 'signup-prompt', town);
  const heading =
    variant === 'local-news'
      ? { wide: `Local news from ${town.name}, every morning.`, phone: 'Local news, daily' }
      : { wide: 'The morning email for people who live here.', phone: 'The morning email' };
  const at = sendTime(config.newsletter_send_time);
  const what = `Weather, what City Hall decided and what's coming up. About five minutes${at ? `, ${at}` : ''}, free.`;
  return (
    <section
      className={`${styles.module} ${styles.cta}`}
      data-module="newsletter-cta"
      data-variant={variant}
    >
      <span className={`${styles.ctaIcon} phone-only`} aria-hidden="true">
        <EnvelopeIcon />
      </span>
      <h2>
        <span className="not-phone">{heading.wide}</span>
        <span className="phone-only">{heading.phone}</span>
      </h2>
      {(await newsletterOpen(town)) ? (
        <>
          <p>
            <span className="not-phone">{what} </span>
            <span className="phone-only">
              {townShortName(config)} in five minutes{at ? `, ${at}` : ''}. Free.{' '}
            </span>
            <Link href="/methods">How we report</Link>.
          </p>
          <NewsletterForm source="/" id="cta" placement={placement} />
        </>
      ) : (
        <p>
          {what} Our newsletter is launching soon. <Link href="/methods">How we report</Link>.
        </p>
      )}
    </section>
  );
};

/** "06:30" → "6:30 a.m." (AP style). */
function sendTime(hhmm: string | undefined): string | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const suffix = h < 12 ? 'a.m.' : 'p.m.';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m[2] === '00' ? `${hour} ${suffix}` : `${hour}:${m[2]} ${suffix}`;
}
