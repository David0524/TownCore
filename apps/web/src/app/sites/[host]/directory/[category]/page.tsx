import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { directoryCategory } from '@towncore/config';
import { categoryListings, MIN_INDEXABLE } from '@towncore/directory';
import { CategoryBar } from '@/components/directory/CategoryBar';
import { CategoryView, loadCategory } from '@/components/directory/CategoryView';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { db } from '@/lib/db';
import { categoryTitle, directoryPath } from '@/lib/directory';
import { rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

type Props = {
  params: Promise<{ host: string; category: string }>;
  searchParams: Promise<{
    q?: string | string[];
    cuisine?: string | string[];
    quote?: string;
    waitlist?: string;
  }>;
};

const queryOf = (raw: string | string[] | undefined) =>
  (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? '';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const town = await requireTown(params);
  const category = directoryCategory((await params).category);
  if (!category) return {};
  const q = queryOf((await searchParams).q);
  const { total } = await categoryListings(db(), town.id, category.slug, { limit: 0 });
  return {
    title: categoryTitle(town, category),
    description: `${total} licensed ${category.name.toLowerCase()} with a ${town.name} address, from Florida's state license records.`,
    alternates: { canonical: directoryPath(category.slug), types: rssAlternate(town) },
    robots: q || total < MIN_INDEXABLE ? { index: false, follow: true } : undefined,
  };
}

/** A directory category: the category bar with this kind marked, then its listings. */
export default async function CategoryPage({ params, searchParams }: Props) {
  const town = await requireTown(params);
  const category = directoryCategory((await params).category);
  if (!category) notFound();
  const { q: rawQ, cuisine: rawCuisine, quote: quoteStatus, waitlist } = await searchParams;
  const data = await loadCategory(town, category, {
    q: queryOf(rawQ),
    cuisine: queryOf(rawCuisine),
  });
  return (
    <StandardPage town={town} shortOnPhones={data.shortOnPhones}>
      <p className="meta">
        <Link href={directoryPath()}>Places</Link> › {category.name}
      </p>
      <LargeTitle title={categoryTitle(town, category)} as="h1" always />
      <CategoryBar town={town} active={category.slug} />
      <CategoryView town={town} data={data} quoteStatus={quoteStatus} waitlistStatus={waitlist} />
    </StandardPage>
  );
}
