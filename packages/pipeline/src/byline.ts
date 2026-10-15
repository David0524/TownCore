// Honest bylines (CLAUDE.md Rule 2). This is the only place a byline string is built; the
// database CHECK constraint on articles backs it up. A story a person approved or edited says
// "Reviewed by an editor" (owner's call, 2026-10-15); who reviewed it is kept in
// `articles.reviewer_id` and the audit log, not printed.
export function buildByline(siteName: string, reviewed = false): string {
  const base = `${siteName.trim()} Newsroom (AI-assisted)`;
  return reviewed ? `${base}. Reviewed by an editor` : base;
}
