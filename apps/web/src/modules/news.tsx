import Link from 'next/link';
import { NewsletterForm } from '@/components/NewsletterForm';
import { newsletterOpen } from '@/lib/newsletter';
import { beats } from '@towncore/config';
import type { Article } from '@towncore/db';
import { formatTownDate } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import { pickLead, recentArticles } from './data';
import type { HomeModuleComponent } from './types';
import styles from './modules.module.css';

function ArticleItem({ article, timezone }: { article: Article; timezone: string }) {
  return (
    <article className={styles.item}>
      <h3>
        <Link href={`/news/${article.slug}`}>{article.headline}</Link>
      </h3>
      {article.dek ? <p className={styles.dek}>{article.dek}</p> : null}
      <p className={`${styles.meta} muted`}>{formatTownDate(article.publishedAt!, { timezone })}</p>
    </article>
  );
}

export const LeadStory: HomeModuleComponent = async ({ town }) => {
  const lead = pickLead(await recentArticles(town.id));
  if (!lead) return null;
  return (
    <section className={`${styles.module} ${styles.lead}`} data-module="lead-story">
      <h2>
        <Link href={`/news/${lead.slug}`}>{lead.headline}</Link>
      </h2>
      {lead.dek ? <p className={styles.dek}>{lead.dek}</p> : null}
      <p className={`${styles.meta} muted`}>{formatTownDate(lead.publishedAt!, town)}</p>
    </section>
  );
};

const INFEED_EVERY = 6;

export const LatestList: HomeModuleComponent = async ({ town, modules }) => {
  const articles = await recentArticles(town.id);
  const lead = modules.includes('lead-story') ? pickLead(articles) : undefined;
  const items = articles.filter((a) => a.id !== lead?.id).slice(0, 12);
  if (items.length === 0) return null;

  // home.infeed every ~6 items, and once at the end of shorter lists.
  const rows: React.ReactNode[] = [];
  items.forEach((article, i) => {
    rows.push(
      <li key={article.id}>
        <ArticleItem article={article} timezone={town.timezone} />
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
      <h2 className={styles.heading}>Latest</h2>
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
      <h2 className={styles.heading}>The briefing</h2>
      {[...byDay].map(([day, dayArticles]) => (
        <div key={day}>
          <p className={styles.day}>{day}</p>
          <ul className={styles.list}>
            {dayArticles.map((article) => (
              <li key={article.id}>
                <Link href={`/news/${article.slug}`}>{article.headline}</Link>
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
          <h2 className={styles.heading}>
            <Link href={`/beat/${beat.slug}`}>{beat.label}</Link>
          </h2>
          <ul className={styles.list}>
            {items.map((article) => (
              <li key={article.id}>
                <ArticleItem article={article} timezone={town.timezone} />
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
