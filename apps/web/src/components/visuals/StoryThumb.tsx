import type { Article, Town } from '@towncore/db';
import { TypographicCard } from '@/components/news/TypographicCard';
import { coverImage, titleCardLabel } from '@/modules/data';
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
  article,
}: {
  town: Town;
  article: Pick<
    Article,
    'id' | 'townId' | 'headline' | 'dek' | 'bodyMd' | 'beat' | 'kind' | 'sourceRecordIds'
  > & { publishedAt?: Date | null };
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
  const label = await titleCardLabel(article);
  return (
    <TypographicCard label={label} siteName={town.siteName} beat={article.beat} ratio="thumb" />
  );
}
