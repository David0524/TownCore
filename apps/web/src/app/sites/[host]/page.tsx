import { Fragment, type ReactNode } from 'react';
import type { HomeModule } from '@towncore/config';
import { bandNeedsCta, homeModules, homeOrder } from '@/modules/registry';
import { themeFor } from '@/lib/theme';
import { requireTown } from '@/lib/town';
import { ListBeacon } from '@/components/Beacon';
import { Slot } from '@/slots/Slot';
import { TownGrid } from '@/layout/TownGrid';
import styles from './home.module.css';

// The homepage is the theme's module lists, not a fixed template (CLAUDE.md §11a-2): an optional
// full-width band (homeTop), the main column (home) and the rail (homeRail).
export default async function HomePage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const theme = themeFor(town);
  const { home: list, homeTop: top = [], homeRail: rail = [] } = theme.layout;
  const modules = [...top, ...list, ...rail];
  const render = (module: HomeModule) => homeModules[module]({ town, theme, modules });

  // Render each module now so empty ones (null) drop out before we place inline slots.
  const rendered: Array<{ key: string; node: ReactNode; mobileOnly: boolean }> = [];
  for (const { module, mobileOnly } of homeOrder(list, top)) {
    const node = await render(module);
    if (node !== null)
      rendered.push({ key: `${module}${mobileOnly ? '-mobile' : ''}`, node, mobileOnly });
  }
  const greeting = top.includes('good-morning') ? await render('good-morning') : null;
  const split = top.filter((m) => m !== 'good-morning');
  const topNodes = (await Promise.all(split.map(render))).map((node, i) => ({
    key: split[i]!,
    node,
  }));
  const railNodes = (await Promise.all(rail.map(render))).filter((node) => node !== null);
  const bandCta = bandNeedsCta(list, top) ? await render('newsletter-cta') : null;
  const hasNews =
    rendered.some(({ key }) => !key.startsWith('newsletter-cta')) ||
    topNodes.some(({ node }) => node !== null);

  const band =
    top.length > 0 ? (
      <>
        {greeting}
        <Slot town={town} name="home.top" />
        <div className={styles.band}>
          {topNodes.map(({ key, node }, i) =>
            node === null ? null : (
              <Fragment key={key}>
                <div className={i === 0 ? styles.bandMain : styles.bandSide}>{node}</div>
                {i === 0 && bandCta ? <div className="mobile-only">{bandCta}</div> : null}
              </Fragment>
            ),
          )}
        </div>
      </>
    ) : null;

  return (
    <TownGrid
      town={town}
      kind={theme.layout.grid}
      top={band}
      railModules={railNodes.length > 0 ? railNodes : null}
    >
      <ListBeacon />
      <h1 className="sr-only">
        {town.siteName}: local news for {town.name}, {town.state}
      </h1>
      {top.length > 0 ? null : <Slot town={town} name="home.top" />}
      {rendered.map(({ key, node, mobileOnly }, i) => (
        <Fragment key={key}>
          <div
            className={
              mobileOnly
                ? 'mobile-only'
                : // On phones the signup already sits in the band, right after the lead.
                  bandCta && key === 'newsletter-cta'
                  ? 'desktop-only'
                  : undefined
            }
          >
            {node}
          </div>
          {/* Single-column layouts have no rail, so rail.box goes inline after the second module. */}
          {theme.layout.grid === 'single-column' && i === 1 ? (
            <Slot town={town} name="rail.box" />
          ) : null}
        </Fragment>
      ))}
      {theme.layout.grid === 'single-column' && rendered.length < 2 ? (
        <Slot town={town} name="rail.box" />
      ) : null}
      {hasNews ? null : (
        <p className="muted" data-testid="home-empty">
          Stories will appear here as soon as our newsroom starts publishing.
        </p>
      )}
    </TownGrid>
  );
}
