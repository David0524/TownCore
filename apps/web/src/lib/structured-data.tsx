import type { Article, Town } from '@towncore/db';
import { articlePath, siteUrl } from './discovery';

// JSON-LD for search engines (CLAUDE.md §11 "SEO"). The publisher is the site itself, so sites
// read as independent local papers (D-M4-4, Rule 1); TownCore is named on About and Privacy.

type Json = Record<string, unknown>;

export function organizationJsonLd(
  town: Pick<Town, 'siteName' | 'domain' | 'name' | 'state'>,
): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    name: town.siteName,
    url: siteUrl(town, '/'),
    areaServed: `${town.name}, ${town.state}`,
    publishingPrinciples: siteUrl(town, '/methods'),
    correctionsPolicy: siteUrl(town, '/corrections'),
  };
}

export function newsArticleJsonLd(
  town: Pick<Town, 'siteName' | 'domain' | 'name' | 'state'>,
  article: Pick<Article, 'slug' | 'headline' | 'dek' | 'beat' | 'publishedAt' | 'updatedAt'>,
): Json {
  // The share image (1200×630) drawn for every article (§11c).
  const image = siteUrl(town, `${articlePath(article.slug)}/og`);
  const publisher = {
    '@type': 'NewsMediaOrganization',
    name: town.siteName,
    url: siteUrl(town, '/'),
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.headline.slice(0, 110),
    description: article.dek ?? undefined,
    mainEntityOfPage: siteUrl(town, articlePath(article.slug)),
    datePublished: article.publishedAt?.toISOString(),
    dateModified: article.updatedAt.toISOString(),
    articleSection: article.beat,
    image: [image],
    // The byline organization ("{Site} Newsroom"); AI assistance is disclosed in the visible byline.
    author: {
      '@type': 'Organization',
      name: `${town.siteName} Newsroom`,
      url: siteUrl(town, '/methods'),
    },
    publisher,
  };
}

/** Renders JSON-LD safely: "<" is escaped so the data can never close the script tag. */
export function JsonLd({ data }: { data: Json }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
