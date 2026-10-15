// Honest bylines (CLAUDE.md Rule 2). This is the only place a byline string is built; the
// database CHECK constraint on articles backs it up.
export function buildByline(siteName: string, reviewerName?: string | null): string {
  const base = `${siteName.trim()} Newsroom (AI-assisted)`;
  const reviewer = reviewerName?.trim();
  return reviewer ? `${base}. Reviewed by ${reviewer}` : base;
}
