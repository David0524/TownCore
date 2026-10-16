import type { Article, Town } from '@towncore/db';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { articlePath } from '@/lib/paths';
import { formatTownDate } from '@/lib/town';
import { BeatLabel } from './BeatLabel';
import { RelativeTime } from './RelativeTime';
import styles from './news.module.css';

type Story = Pick<Article, 'slug' | 'headline' | 'dek' | 'beat' | 'publishedAt'> &
  Partial<Pick<Article, 'kind'>>;

export type StoryVariant = 'lead' | 'secondary' | 'brief' | 'list';

/**
 * One story at one level of the front page (docs/plans/M4b.md §3): a distinct type size per
 * level, beat label and relative time, and headline links that underline only on hover.
 * - lead: visual, label, display headline, dek.
 * - secondary: label, headline, dek, with a left hairline.
 * - brief: label and time in a column beside the headline and a one-line summary.
 * - list: headline and time on one row.
 */
export function StoryBlock({
  story,
  town,
  variant,
  visual,
  as: Heading = 'h3',
}: {
  story: Story;
  town: Pick<Town, 'timezone'>;
  variant: StoryVariant;
  visual?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  const href = articlePath(story.slug, story.kind);
  const time = story.publishedAt ? (
    <RelativeTime
      iso={story.publishedAt.toISOString()}
      absolute={formatTownDate(story.publishedAt, town)}
    />
  ) : null;
  const headline = (
    <Heading className={styles.headline}>
      <Link href={href}>{story.headline}</Link>
    </Heading>
  );

  if (variant === 'list') {
    return (
      <article className={styles.list} data-story="list">
        {headline}
        <span className="meta">{time}</span>
      </article>
    );
  }
  if (variant === 'brief') {
    return (
      <article className={styles.brief} data-story="brief">
        <BeatLabel beat={story.beat}>{time}</BeatLabel>
        <div>
          {headline}
          {story.dek ? <p className={styles.summary}>{story.dek}</p> : null}
        </div>
      </article>
    );
  }
  return (
    <article className={variant === 'lead' ? styles.lead : styles.secondary} data-story={variant}>
      {visual ? (
        <Link href={href} className={styles.visual} tabIndex={-1} aria-hidden="true">
          {visual}
        </Link>
      ) : null}
      <BeatLabel beat={story.beat} link>
        {time}
      </BeatLabel>
      {headline}
      {story.dek ? <p className={styles.dek}>{story.dek}</p> : null}
    </article>
  );
}
