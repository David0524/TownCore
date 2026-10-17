import type { Metadata } from 'next';
import { Prose } from '@/components/Prose';
import { fillTemplate } from '@/content/fill';
import { methodsCopy } from '@/content/methods';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'How we report', alternates: { canonical: '/methods' } };

export default async function MethodsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  return (
    <StandardPage town={town}>
      <h1>How we report</h1>
      <Prose markdown={fillTemplate(methodsCopy, town)} />
    </StandardPage>
  );
}
