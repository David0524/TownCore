import type { Metadata } from 'next';
import { Prose } from '@/components/Prose';
import { sourceLabel } from '@/content/beats';
import { fillTemplate } from '@/content/fill';
import { methodsCopy } from '@/content/methods';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { realStoryCounts, townSources } from '@/modules/data';

export const metadata: Metadata = { title: 'How we report', alternates: { canonical: '/methods' } };

/**
 * How we report (Rule 1). It opens with this town's own record sources and story count, so
 * every site's Methods page starts with something only it can say (near-duplicate guard,
 * owner 2026-10-17); the process that follows is the same everywhere by design.
 */
export default async function MethodsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const [ours, counts] = await Promise.all([townSources(town.id), realStoryCounts(town.id)]);
  const labels = [
    ...new Set(ours.filter((s) => s.kind !== 'other_outlet').map((s) => sourceLabel(s))),
  ];
  return (
    <StandardPage town={town}>
      <h1>How we report</h1>
      {labels.length > 0 && (
        <section data-testid="methods-town-sources">
          <h2>What we read for {town.name}</h2>
          <p>
            {town.siteName} has published{' '}
            {counts.total === 1 ? '1 story' : `${counts.total} stories`} from these records:
          </p>
          <ul>
            {labels.map((label) => (
              <li key={label}>{label[0]!.toUpperCase() + label.slice(1)}</li>
            ))}
          </ul>
        </section>
      )}
      <Prose markdown={fillTemplate(methodsCopy, town)} />
    </StandardPage>
  );
}
