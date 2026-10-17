import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PhoneBar } from '@/components/phone/PhoneBar';
import { TabBar } from '@/components/phone/TabBar';
import { SlotBeacon } from '@/components/SlotBeacon';
import { externalLinksScript } from '@/components/ExternalLinks';
import { AlertBar } from '@/components/weather/AlertBar';
import { followBootScript, followCss } from '@/components/phone/follow';
import { offerBootScript } from '@/components/SecondArticleOffer';
import { PhoneWordmark } from '@/components/phone/PhoneWordmark';
import { YourTown } from '@/components/phone/YourTown';
import { newsletterOpen } from '@/lib/newsletter';
import { beatColorVar } from '@/lib/theme';
import { beats } from '@towncore/config';
import { WeatherLine } from '@/components/weather/WeatherLine';
import { footers, headers, headersWithWeather, navs } from '@/layout/registry';
import { townWeather } from '@/modules/data';
import { isIndexable, rssAlternate } from '@/lib/discovery';
import { themeCssVariables, themeFor } from '@/lib/theme';
import { requireTown, resolveTown } from '@/lib/town';
import { homeScreenName, townIconDir } from '@/lib/app-icon';

type Props = { children: ReactNode; params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  if (!town) return {};
  return {
    metadataBase: new URL(`https://${town.domain}`),
    title: { default: town.siteName, template: `%s · ${town.siteName}` },
    description: `Local news for ${town.name}, ${town.state}, written from public records.`,
    alternates: { types: rssAlternate(town) },
    // Nothing is indexed until a human sets the town live (Rule 10), or while staff hide it from
    // search (the kill switch).
    robots: isIndexable(town) ? undefined : { index: false, follow: false },
    manifest: '/manifest.webmanifest',
    icons: townIconDir(town)
      ? {
          icon: [
            { url: `${townIconDir(town)}/icon-32.png`, sizes: '32x32', type: 'image/png' },
            { url: `${townIconDir(town)}/icon-192.png`, sizes: '192x192', type: 'image/png' },
          ],
          apple: [{ url: `${townIconDir(town)}/icon-180.png`, sizes: '180x180' }],
        }
      : {
          icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
        },
    // Opens standalone from the Home Screen, under the town's short name.
    appleWebApp: { capable: true, title: homeScreenName(town), statusBarStyle: 'default' },
  };
}

// Each town is assembled from the layout parts its theme names (CLAUDE.md §11a-2).
const beatSlugs = beats.map((b) => b.slug);

export default async function TownLayout({ children, params }: Props) {
  const town = await requireTown(params);
  const theme = themeFor(town);
  const Header = headers[theme.layout.header];
  const Nav = navs[theme.layout.nav];
  const Footer = footers[theme.layout.footer];
  const [weather, open] = await Promise.all([townWeather(town.id), newsletterOpen(town)]);
  const snapshot = weather?.kind === 'snapshot' ? weather.snapshot : null;
  const lineOn = {
    desktop: !(snapshot && headersWithWeather.has(theme.layout.header)),
    phone: !snapshot,
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{ __html: themeCssVariables(theme) + followCss(beatSlugs) }}
      />
      {/* Followed sections ("Your Boca") are applied before first paint: no layout shift. */}
      <script dangerouslySetInnerHTML={{ __html: followBootScript }} />
      <script dangerouslySetInnerHTML={{ __html: externalLinksScript }} />
      <script dangerouslySetInnerHTML={{ __html: offerBootScript }} />
      {/* Family-specific styling keys on this attribute (docs/plans/M4b.md revision 6). */}
      <div data-family={theme.family} className="family">
        {/* Phones get iOS chrome instead of the town's header (docs/plans/M4b.md revision 5). */}
        <PhoneBar
          weather={
            snapshot
              ? {
                  value: `${snapshot.now.temperature}°`,
                  href: snapshot.sourceUrl,
                  label: `${town.name} weather: ${snapshot.now.temperature}° this hour, National Weather Service`,
                }
              : null
          }
          wordmark={<PhoneWordmark town={town} theme={theme} />}
          action={
            <YourTown
              townName={town.name}
              beats={beats.map((b) => ({
                slug: b.slug,
                label: b.label,
                color: beatColorVar(b.slug),
              }))}
              newsletter={open ? 'open' : 'soon'}
            />
          }
        />
        <AlertBar town={town} weather={weather} />
        <div className="not-phone site-header">
          <Header town={town} theme={theme} nav={<Nav town={town} />} weather={weather} />
        </div>
        {/* Weather above the fold everywhere (§11a): the header or the phone bar shows this
          hour's temperature; otherwise the weather line does. */}
        {lineOn.desktop || lineOn.phone ? (
          <div
            className={
              lineOn.desktop && lineOn.phone ? undefined : lineOn.phone ? 'phone-only' : 'not-phone'
            }
          >
            <WeatherLine town={town} weather={weather} />
          </div>
        ) : null}
        {children}
        <Footer town={town} theme={theme} />
        <TabBar />
        <SlotBeacon />
      </div>
    </>
  );
}
