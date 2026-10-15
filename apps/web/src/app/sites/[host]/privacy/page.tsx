import type { Metadata } from 'next';
import { Prose } from '@/components/Prose';
import { fillTemplate } from '@/content/fill';
import { privacyCopy } from '@/content/privacy';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Privacy', alternates: { canonical: '/privacy' } };

export default async function PrivacyPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  return (
    <StandardPage town={town}>
      <h1>Privacy</h1>
      <Prose markdown={fillTemplate(privacyCopy, town)} />
    </StandardPage>
  );
}
