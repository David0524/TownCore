import { network } from '@towncore/config';

// Shown for unknown hosts and missing pages. Unknown hosts never fall back to a default town.
export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>We couldn&apos;t find that page.</p>
      <p className="muted">
        This site is part of the {network.name} network, operated by {network.company}. Contact:{' '}
        <a href={`mailto:${network.contactEmail}`}>{network.contactEmail}</a>
      </p>
    </main>
  );
}
