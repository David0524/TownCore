import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { footers, headers, navs } from '@/layout/registry';
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

// Each town is assembled from the layout parts its theme names (CLAUDE.md §11a-2).
export default async function TownLayout({ children, params }: Props) {
  const town = await requireTown(params);
  const theme = themeFor(town);
  const Header = headers[theme.layout.header];
  const Nav = navs[theme.layout.nav];
  const Footer = footers[theme.layout.footer];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCssVariables(theme) }} />
      <Header town={town} theme={theme} nav={<Nav />} />
      {children}
      <Footer town={town} theme={theme} />
    </>
  );
}
