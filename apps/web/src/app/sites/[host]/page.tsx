import { Fragment, type ReactNode } from 'react';
import { homeModules, homeOrder } from '@/modules/registry';
import { themeFor } from '@/lib/theme';
import { requireTown } from '@/lib/town';
import { Slot } from '@/slots/Slot';
import { TownGrid } from '@/layout/TownGrid';

// The homepage is the theme's ordered module list, not a fixed template (CLAUDE.md §11a-2).
export default async function HomePage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const theme = themeFor(town);
  const list = theme.layout.home;

  // Render each module now so empty ones (null) drop out before we place inline slots.
  const rendered: Array<{ key: string; node: ReactNode; mobileOnly: boolean }> = [];
  for (const { module, mobileOnly } of homeOrder(list)) {
    const node = await homeModules[module]({ town, theme, modules: list });
    if (node !== null)
      rendered.push({ key: `${module}${mobileOnly ? '-mobile' : ''}`, node, mobileOnly });
  }
  const hasNews = rendered.some(({ key }) => !key.startsWith('newsletter-cta'));

  return (
    <TownGrid town={town} kind={theme.layout.grid}>
      <h1 className="sr-only">
        {town.siteName}: local news for {town.name}, {town.state}
      </h1>
      <Slot town={town} name="home.top" />
      {rendered.map(({ key, node, mobileOnly }, i) => (
        <Fragment key={key}>
          <div className={mobileOnly ? 'mobile-only' : undefined}>{node}</div>
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
