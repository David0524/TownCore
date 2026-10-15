// Shown for unknown hosts and missing pages. Unknown hosts never fall back to a default town,
// and nothing here names the publisher (sites look independent; CLAUDE.md Rule 1).
export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>We couldn&apos;t find that page.</p>
    </main>
  );
}
