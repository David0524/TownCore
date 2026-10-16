import type { Theme } from '@towncore/config';
import type { Article, Town } from '@towncore/db';
import { TypographicCard, type CardFigure } from '@/components/news/TypographicCard';
import { articleImage } from '@/modules/data';
import { DataGraphic } from './DataGraphic';

/**
 * The article's chosen visual (CLAUDE.md §11c): a data graphic built from its records, or the
 * typographic card the router always falls back to. Maps join with M4 PR E.
 */
export async function ArticleVisual({
  town,
  theme,
  article,
  figure,
}: {
  town: Town;
  theme: Theme;
  article: Pick<Article, 'id' | 'headline' | 'beat' | 'kind' | 'sourceRecordIds'>;
  figure?: CardFigure | null;
}) {
  const image = await articleImage(article, town.timezone);
  if (image.kind === 'data-graphic' && image.spec.type === 'daily-counts') {
    return <DataGraphic spec={image.spec} alt={image.alt} />;
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
