import { publisher as company } from '@towncore/config';
import type { Article, SourceRecord, Town } from '@towncore/db';
import { articlePath, siteUrl } from './discovery';

// JSON-LD for search engines (CLAUDE.md §11 "SEO"). The publisher is the site itself, so sites
// read as independent local papers (D-M4-4, Rule 1); TownCore is named on About and Privacy.
// The About page's organization names TownCore as its parent (owner, 2026-10-17: transparency
// for search engines), and every article's publisher points to that organization by its @id.

type Json = Record<string, unknown>;

/** The site's organization node, shared by About and every article's publisher. */
const organizationId = (town: Pick<Town, 'domain'>) => siteUrl(town, '/about#organization');

export function organizationJsonLd(
  town: Pick<Town, 'siteName' | 'domain' | 'name' | 'state'>,
): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    '@id': organizationId(town),
    name: town.siteName,
    url: siteUrl(town, '/'),
    areaServed: `${town.name}, ${town.state}`,
    publishingPrinciples: siteUrl(town, '/methods'),
    correctionsPolicy: siteUrl(town, '/corrections'),
    parentOrganization: { '@type': 'Organization', name: company.name },
  };
}

export function newsArticleJsonLd(
  town: Pick<Town, 'siteName' | 'domain' | 'name' | 'state'>,
  article: Pick<
    Article,
    'slug' | 'headline' | 'dek' | 'beat' | 'kind' | 'publishedAt' | 'updatedAt'
  >,
  /** The story's source records (Rule 4): every one is cited, even when the page collapses them. */
  sourceRecords: Pick<SourceRecord, 'title' | 'type' | 'url'>[] = [],
): Json {
  // The share image (1200×630) drawn for every article (§11c).
  const image = siteUrl(town, `/news/${article.slug}/og`);
  const publisher = {
    '@type': 'NewsMediaOrganization',
    '@id': organizationId(town),
    name: town.siteName,
    url: siteUrl(town, '/'),
  };
  return {
    '@context': 'https://schema.org',
    // Guides are evergreen reference pages, not news (docs/plans/M4.md: "Guides: Article").
    '@type': article.kind === 'guide' ? 'Article' : 'NewsArticle',
    headline: article.headline.slice(0, 110),
    description: article.dek ?? undefined,
    mainEntityOfPage: siteUrl(town, articlePath(article.slug, article.kind)),
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
    citation: sourceRecords.length
      ? sourceRecords.map((r) => ({
          '@type': 'CreativeWork',
          name: r.title ?? r.type,
          ...(r.url ? { url: r.url } : {}),
        }))
      : undefined,
  };
}

/**
 * schema.org Event for an event page: the official calendar's own facts only (no image, price
 * or performer we don't have). The organizer is the government or calendar it came from.
 */
export function eventJsonLd(
  town: Pick<Town, 'domain' | 'name' | 'state'>,
  event: {
    path: string;
    title: string;
    when: Date;
    end: Date | null;
    allDay: boolean;
    venue: string | null;
    street: string | null;
    description: string | null;
    officialUrl: string | null;
    organizer: string | null;
  },
  timeZone: string,
): Json {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    url: siteUrl(town, event.path),
    // All-day events are dates (schema.org allows a Date); timed ones the exact instant.
    startDate: event.allDay ? day(event.when) : event.when.toISOString(),
    endDate: event.end
      ? event.allDay
        ? day(new Date(event.end.getTime() - 1))
        : event.end.toISOString()
      : undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    description: event.description ?? undefined,
    location: {
      '@type': 'Place',
      name: event.venue ?? `${town.name}, ${town.state}`,
      address: {
        '@type': 'PostalAddress',
        ...(event.street ? { streetAddress: event.street } : {}),
        addressLocality: town.name,
        addressRegion: town.state,
        addressCountry: 'US',
      },
    },
    organizer: event.organizer
      ? {
          '@type': 'Organization',
          name: event.organizer,
          ...(event.officialUrl ? { url: event.officialUrl } : {}),
        }
      : undefined,
    sameAs: event.officialUrl ?? undefined,
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
