import type { Metadata } from 'next';
import { Prose } from '@/components/Prose';
import { fillTemplate } from '@/content/fill';
import { privacyCopy } from '@/content/privacy';
import { THIN_PAGE } from '@/lib/indexing';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

// The policy is the same text on every site by design, so search engines don't list it (it
// would read as a near-duplicate across towns, owner 2026-10-17); its links are still followed.
export const metadata: Metadata = {
  title: 'Privacy',
  alternates: { canonical: '/privacy' },
  robots: THIN_PAGE,
};

export default async function PrivacyPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  return (
    <StandardPage town={town}>
      <h1>Privacy</h1>
      <Prose markdown={fillTemplate(privacyCopy, town)} />
    </StandardPage>
  );
}
