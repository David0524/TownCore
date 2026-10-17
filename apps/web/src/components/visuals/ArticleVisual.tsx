import type { Article, Town } from '@towncore/db';
import { TypographicCard, type CardFigure } from '@/components/news/TypographicCard';
import { articleImage, coverImage, titleCardLabel } from '@/modules/data';
import { DataGraphic } from './DataGraphic';
import { MapGraphic } from './MapGraphic';
import { SectionIllustration } from './SectionIllustration';
import { SentPhoto } from './SentPhoto';
import { StockPhoto } from './StockPhoto';

/**
 * The article's chosen visual (CLAUDE.md §11c): a data graphic built from its records, or the
 * block-level map, a guide's credited stock photo, an approved photo someone sent us (or an
 * approved, labeled AI illustration, its own or a section one from the library), or the typographic card the router always falls back to.
 */
export async function ArticleVisual({
  town,
  article,
  figure,
  cover = false,
}: {
  town: Town;
  article: Pick<
    Article,
    'id' | 'townId' | 'headline' | 'dek' | 'bodyMd' | 'beat' | 'kind' | 'sourceRecordIds'
  > & { publishedAt?: Date | null };
  figure?: CardFigure | null;
  /** The homepage lead: a cover, never a chart (the chart stays in the article). */
  cover?: boolean;
}) {
  const image = await (cover ? coverImage : articleImage)(article, town.timezone);
  if (image.kind === 'data-graphic' && image.spec.type === 'daily-counts') {
    return <DataGraphic spec={image.spec} alt={image.alt} />;
  }
  if (image.kind === 'map' && image.spec.type === 'map') {
    return <MapGraphic spec={image.spec} alt={image.alt} />;
  }
  if (image.kind === 'stock' && image.spec.type === 'stock') {
    return <StockPhoto spec={image.spec} alt={image.alt} siteName={town.siteName} />;
  }
  if (image.spec.type === 'photo') {
    return <SentPhoto kind={image.kind} spec={image.spec} alt={image.alt} />;
  }
  if (image.spec.type === 'illustration') {
    return <SectionIllustration spec={image.spec} alt={image.alt} />;
  }
  const label = await titleCardLabel(article);
  return (
    <TypographicCard label={label} siteName={town.siteName} beat={article.beat} figure={figure} />
  );
}
