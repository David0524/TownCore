// Bylines (CLAUDE.md Rule 2). This is the only place a byline string is built; the database
// CHECK constraint on articles backs it up. The newsroom's name, with no AI label (owner's call,
// 2026-10-16; the How we report page explains how stories are made). A story a person approved
// or edited says "Reviewed by an editor"; who reviewed it is kept in `articles.reviewer_id` and
// the audit log, not printed.
export function buildByline(siteName: string, reviewed = false): string {
  const base = `${siteName.trim()} Newsroom`;
  return reviewed ? `${base}. Reviewed by an editor` : base;
}
