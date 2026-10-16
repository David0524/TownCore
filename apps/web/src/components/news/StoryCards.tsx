import type { Theme } from '@towncore/config';
import type { Article, Town } from '@towncore/db';
import Link from 'next/link';
import { StoryThumb } from '@/components/visuals/StoryThumb';
import { articlePath } from '@/lib/paths';
import { BeatLabel } from './BeatLabel';
import styles from './cards.module.css';

type CardStory = Pick<
  Article,
  | 'id'
  | 'townId'
  | 'slug'
  | 'headline'
  | 'dek'
  | 'bodyMd'
  | 'beat'
  | 'kind'
  | 'sourceRecordIds'
  | 'publishedAt'
>;

/**
 * More top stories as a row of picture cards that scrolls sideways (owner, 2026-10-16: give
 * phone readers a reason to keep going). About two and a bit cards show, so the next one is
 * visibly cut off and invites a swipe.
 */
export function TopStoriesRow({
  town,
  theme,
  stories,
}: {
  town: Town;
  theme: Theme;
  stories: CardStory[];
}) {
  if (stories.length < 2) return null;
  return (
    <section className={styles.row} aria-labelledby="top-row-h" data-testid="top-stories-row">
      <h2 id="top-row-h" className={styles.rowTitle}>
        More top stories
      </h2>
      <ul className={styles.rowList}>
        {stories.map((story) => (
          <li key={story.id}>
            <Link href={articlePath(story.slug, story.kind)} className={styles.card}>
              <div className={styles.cardVisual} aria-hidden="true">
                <StoryThumb town={town} theme={theme} article={story} />
              </div>
              <BeatLabel beat={story.beat} />
              <span className={styles.cardHeadline}>{story.headline}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Up next" at the end of a story (owner, 2026-10-16): one picture card for the story to read
 * next, so the end of a story leads somewhere instead of out of the site.
 */
export function UpNext({ town, theme, story }: { town: Town; theme: Theme; story: CardStory }) {
  return (
    <section className={styles.upNext} aria-labelledby="up-next-h" data-testid="up-next">
      <h2 id="up-next-h" className={styles.upNextLabel}>
        Up next
      </h2>
      <Link href={articlePath(story.slug, story.kind)} className={styles.upNextCard}>
        <div className={styles.upNextVisual} aria-hidden="true">
          <StoryThumb town={town} theme={theme} article={story} />
        </div>
        <div className={styles.upNextText}>
          <BeatLabel beat={story.beat} />
          <span className={styles.upNextHeadline}>{story.headline}</span>
          {story.dek ? <span className={styles.upNextDek}>{story.dek}</span> : null}
          <span className={styles.upNextCta}>Read the story →</span>
        </div>
      </Link>
    </section>
  );
}
