import { describe, expect, it } from 'vitest';
import {
  newsSitemap,
  robotsTxt,
  rssFeed,
  xmlEscape,
  type ListedArticle,
} from '../src/lib/discovery';

const town = {
  domain: 'example.test',
  siteName: 'The <Example> & Co',
  name: 'Example',
  state: 'FL',
};
const now = new Date('2026-10-15T12:00:00Z');
const article = (slug: string, hoursAgo: number): ListedArticle => ({
  slug,
  kind: 'story',
  headline: `Story ${slug} & more`,
  dek: null,
  beat: 'government',
  publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000),
  updatedAt: now,
});

describe('discovery builders', () => {
  it('escapes XML', () => {
    expect(xmlEscape(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('robots.txt: draft towns disallow everything', () => {
    expect(robotsTxt({ ...town, status: 'draft' })).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsTxt({ ...town, status: 'paused' })).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsTxt({ ...town, status: 'live' })).toContain(
      'Sitemap: https://example.test/sitemap.xml',
    );
  });

  it('news sitemap keeps 48 hours and at most 1,000 entries', () => {
    const xml = newsSitemap(town, [article('a', 1), article('b', 47), article('c', 49)], now);
    expect(xml).toContain('/news/a<');
    expect(xml).toContain('/news/b<');
    expect(xml).not.toContain('/news/c<');
    expect(xml).toContain('<news:name>The &lt;Example&gt; &amp; Co</news:name>');
    const many = Array.from({ length: 1200 }, (_, i) => article(`s${i}`, 1));
    expect(newsSitemap(town, many, now).match(/<news:news>/g)).toHaveLength(1000);
  });

  it('rss has a self link and escaped items', () => {
    const xml = rssFeed(town, [article('a', 1)], { selfPath: '/feed.xml' });
    expect(xml).toContain('<atom:link href="https://example.test/feed.xml" rel="self"');
    expect(xml).toContain('<title>Story a &amp; more</title>');
    expect(xml).toContain('<guid isPermaLink="true">https://example.test/news/a</guid>');
  });
});
