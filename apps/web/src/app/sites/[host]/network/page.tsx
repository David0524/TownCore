import type { Metadata } from 'next';
import { network } from '@towncore/config';
import { listLiveTowns } from '@towncore/db';
import { db } from '@/lib/db';
import { requireTown } from '@/lib/town';
import styles from './network.module.css';

export const metadata: Metadata = { title: `About the ${network.name} network` };

// Network About page (CLAUDE.md rule 1). towncore.net is internal, so this lives on every site.
export default async function NetworkPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const liveTowns = await listLiveTowns(db());

  return (
    <main>
      <div className={styles.panel} data-testid="network-panel">
        <h1>About the {network.name} network</h1>
        <p>
          {town.siteName} is part of {network.name}, a network of local news sites operated by{' '}
          <strong>{network.company}</strong>. Each site covers one town and is written by an
          AI-assisted newsroom from primary public sources, such as government meetings, permits,
          business filings and official releases.
        </p>
        <p>
          Every site in the network follows the same standards: stories are written only from public
          records, every story links to its sources, sensitive stories are reviewed by a person
          before they publish, and paid placements are always labeled &ldquo;Sponsored.&rdquo;
        </p>
        <h2>Contact</h2>
        <p>
          {network.company}: <a href={`mailto:${network.contactEmail}`}>{network.contactEmail}</a>
        </p>
        <h2>Sites in the network</h2>
        {liveTowns.length === 0 ? (
          <p>Our first sites are launching soon.</p>
        ) : (
          <ul>
            {liveTowns.map((t) => (
              <li key={t.id}>
                <a href={`https://${t.domain}`}>{t.siteName}</a> ({t.name}, {t.state})
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
