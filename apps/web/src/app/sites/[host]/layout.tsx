import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PhoneBar } from '@/components/phone/PhoneBar';
import { TabBar } from '@/components/phone/TabBar';
import { AlertBar } from '@/components/weather/AlertBar';
import { PhoneWordmark } from '@/components/phone/PhoneWordmark';
import { WeatherLine } from '@/components/weather/WeatherLine';
import { footers, headers, headersWithWeather, navs } from '@/layout/registry';
import { townWeather } from '@/modules/data';
import { rssAlternate } from '@/lib/discovery';
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
    alternates: { types: rssAlternate(town) },
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
  const weather = await townWeather(town.id);
  const snapshot = weather?.kind === 'snapshot' ? weather.snapshot : null;
  const lineOn = {
    desktop: !(snapshot && headersWithWeather.has(theme.layout.header)),
    phone: !snapshot,
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCssVariables(theme) }} />
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
      />
      <AlertBar town={town} weather={weather} />
      <div className="not-phone">
        <Header town={town} theme={theme} nav={<Nav />} weather={weather} />
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
    </>
  );
}
