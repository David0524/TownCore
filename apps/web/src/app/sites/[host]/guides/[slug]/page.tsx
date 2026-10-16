import type { Metadata } from 'next';
import { ArticleView, articleMetadata } from '../../news/[slug]/article-view';

// Evergreen guides (M4 PR F): the article page, with guide dates and the official-pages note.
type Props = { params: Promise<{ host: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return articleMetadata(params, 'guides');
}

export default async function GuidePage({ params }: Props) {
  return ArticleView({ params, section: 'guides' });
}
