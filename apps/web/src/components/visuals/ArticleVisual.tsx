import type { Theme } from '@towncore/config';
import type { Article, Town } from '@towncore/db';
import { TypographicCard, type CardFigure } from '@/components/news/TypographicCard';
import { articleImage } from '@/modules/data';
import { DataGraphic } from './DataGraphic';
import { MapGraphic } from './MapGraphic';

/**
 * The article's chosen visual (CLAUDE.md §11c): a data graphic built from its records, or the
 * block-level map, or the typographic card the router always falls back to.
 */
export async function ArticleVisual({
  town,
  theme,
  article,
  figure,
}: {
  town: Town;
  theme: Theme;
  article: Pick<
    Article,
    'id' | 'townId' | 'headline' | 'dek' | 'bodyMd' | 'beat' | 'kind' | 'sourceRecordIds'
  >;
  figure?: CardFigure | null;
}) {
  const image = await articleImage(article, town.timezone);
  if (image.kind === 'data-graphic' && image.spec.type === 'daily-counts') {
    return <DataGraphic spec={image.spec} alt={image.alt} />;
  }
  if (image.kind === 'map' && image.spec.type === 'map') {
    return <MapGraphic spec={image.spec} alt={image.alt} />;
  }
  return (
    <TypographicCard
      theme={theme}
      beat={article.beat}
      headline={article.headline}
      figure={figure}
    />
  );
}
