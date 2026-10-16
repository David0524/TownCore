import type { Theme } from '@towncore/config';
import type { Article, Town } from '@towncore/db';
import { TypographicCard } from '@/components/news/TypographicCard';
import { coverImage, roundupFigure } from '@/modules/data';
import { MapGraphic } from './MapGraphic';
import { SectionIllustrationThumb } from './SectionIllustration';
import styles from './visuals.module.css';

/**
 * A story's visual at list-row size (canvas "Homepage", Latest): a photo we may show, the block
 * map, or a small typographic tile with the motif, the beat glyph and any figure the story's
 * records support. Decorative here: the headline beside it says what the story is.
 */
export async function StoryThumb({
  town,
  theme,
  article,
}: {
  town: Town;
  theme: Theme;
  article: Pick<
    Article,
    'id' | 'townId' | 'headline' | 'dek' | 'bodyMd' | 'beat' | 'kind' | 'sourceRecordIds'
  >;
}) {
  const image = await coverImage(article, town.timezone);
  if (image.spec.type === 'photo') {
    return (
      <img
        src={`/photos/${image.spec.photoId}.jpg`}
        alt=""
        width={image.spec.width}
        height={image.spec.height}
        loading="lazy"
        decoding="async"
        className={styles.thumbImage}
      />
    );
  }
  if (image.spec.type === 'illustration') return <SectionIllustrationThumb spec={image.spec} />;
  if (image.kind === 'map' && image.spec.type === 'map') {
    return (
      <div className={styles.thumbMap} aria-hidden="true">
        <MapGraphic spec={image.spec} alt="" />
      </div>
    );
  }
  const figure = await roundupFigure(article);
  return (
    <TypographicCard
      theme={theme}
      beat={article.beat}
      headline={article.headline}
      figure={figure}
      ratio="thumb"
    />
  );
}
