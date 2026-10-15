import type { Metadata } from 'next';
import { Prose } from '@/components/Prose';
import { aboutCopy } from '@/content/about';
import { fillTemplate } from '@/content/fill';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'About us' };

export default async function AboutPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  return (
    <StandardPage town={town}>
      <h1>About {town.siteName}</h1>
      <Prose markdown={fillTemplate(aboutCopy, town)} />
    </StandardPage>
  );
}
