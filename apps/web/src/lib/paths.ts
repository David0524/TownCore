/** Where an article lives: guides under /guides (M4 PR F), everything else under /news. */
export const articlePath = (slug: string, kind?: string | null) =>
  kind === 'guide' ? `/guides/${slug}` : `/news/${slug}`;
