import type { Metadata } from 'next';
import { Prose } from '@/components/Prose';
import { aboutCopy } from '@/content/about';
import { fillTemplate } from '@/content/fill';
import { rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { JsonLd, organizationJsonLd } from '@/lib/structured-data';
import { requireTown, resolveTown } from '@/lib/town';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  return {
    title: 'About us',
    alternates: { canonical: '/about', types: town ? rssAlternate(town) : undefined },
  };
}

export default async function AboutPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  return (
    <StandardPage town={town}>
      <JsonLd data={organizationJsonLd(town)} />
      <h1>About {town.siteName}</h1>
      <Prose markdown={fillTemplate(aboutCopy, town)} />
    </StandardPage>
  );
}
