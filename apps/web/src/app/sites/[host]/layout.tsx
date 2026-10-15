import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { themeCssVariables, themeFor } from '@/lib/theme';
import { requireTown, resolveTown } from '@/lib/town';

type Props = { children: ReactNode; params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  if (!town) return {};
  return {
    metadataBase: new URL(`https://${town.domain}`),
    title: { default: town.siteName, template: `%s · ${town.siteName}` },
    description: `Local news for ${town.name}, ${town.state}, written from public records.`,
    // Nothing is indexed until a human sets the town live (rules 7 and 10).
    robots: town.status === 'live' ? undefined : { index: false, follow: false },
  };
}

export default async function TownLayout({ children, params }: Props) {
  const town = await requireTown(params);
  const logo = (town.config as { logo?: string }).logo;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCssVariables(themeFor(town)) }} />
      <SiteHeader siteName={town.siteName} logo={logo} />
      {children}
      <SiteFooter siteName={town.siteName} />
    </>
  );
}
