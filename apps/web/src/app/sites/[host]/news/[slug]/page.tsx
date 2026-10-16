import type { Metadata } from 'next';
import { ArticleView, articleMetadata } from './article-view';

type Props = { params: Promise<{ host: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return articleMetadata(params, 'news');
}

export default async function ArticlePage({ params }: Props) {
  return ArticleView({ params, section: 'news' });
}
