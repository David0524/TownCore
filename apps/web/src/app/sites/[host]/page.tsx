import type { Metadata } from 'next';
import { Fragment, type ReactNode } from 'react';
import type { HomeModule } from '@towncore/config';
import { bandNeedsCta, homeModules, homeOrder, SPANNING_MODULES } from '@/modules/registry';
import { themeFor } from '@/lib/theme';
import { thinUnless } from '@/lib/indexing';
import { requireTown, resolveTown } from '@/lib/town';
import { realStoryCounts } from '@/modules/data';
import { ListBeacon } from '@/components/Beacon';
import { HomeScreenCard } from '@/components/phone/HomeScreenCard';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { CategoryCapsules, greeting } from '@/modules/front';
import { Slot } from '@/slots/Slot';
import { TownGrid } from '@/layout/TownGrid';
import styles from './home.module.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  if (!town) return {};
  // A front page with fewer than 3 real stories stays out of search until it has them.
  return { robots: thinUnless(town, (await realStoryCounts(town.id)).total) };
}

// The homepage is the theme's module lists, not a fixed template (CLAUDE.md §11a-2): an optional
// full-width band (homeTop), the main column (home), the rail (homeRail) and an optional
// full-width band below them (homeBottom).
export default async function HomePage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const theme = themeFor(town);
  const {
    home: list,
    homeTop: top = [],
    homeRail: rail = [],
    homeBottom: bottom = [],
  } = theme.layout;
  const modules = [...top, ...list, ...rail, ...bottom];
  const render = (module: HomeModule) => homeModules[module]({ town, theme, modules });

  // Render each module now so empty ones (null) drop out before we place inline slots.
  const rendered: Array<{ key: string; node: ReactNode; mobileOnly: boolean }> = [];
  for (const { module, mobileOnly } of homeOrder(list, top)) {
    const node = await render(module);
    if (node !== null)
      rendered.push({ key: `${module}${mobileOnly ? '-mobile' : ''}`, node, mobileOnly });
  }
  const hello = top.includes('good-morning') ? await render('good-morning') : null;
  // The quick-links bar spans the band right under the greeting (desktop; phones have tabs).
  const quick = top.includes('quick-links') ? await render('quick-links') : null;
  // Section tiles at the start of the band span it (community), like the greeting.
  const spanning = top.includes('category-buttons') ? await render('category-buttons') : null;
  const split = top.filter((m) => !SPANNING_MODULES.has(m));
  const topNodes = (await Promise.all(split.map(render))).map((node, i) => ({
    key: split[i]!,
    node,
  }));
  const railNodes = (await Promise.all(rail.map(render))).filter((node) => node !== null);
  const bottomNodes = (await Promise.all(bottom.map(render)))
    .map((node, i) => ({ key: bottom[i]!, node }))
    .filter(({ node }) => node !== null);
  const bandCta = bandNeedsCta(list, top) ? await render('newsletter-cta') : null;
  const hasNews =
    rendered.some(({ key }) => !key.startsWith('newsletter-cta')) ||
    topNodes.some(({ node }) => node !== null);

  // Phones open on a large "Today" title with the greeting (search is the tab bar's), on every town.
  const now = new Date();
  const phoneTitle = (
    <LargeTitle
      title="Today"
      overline={`${greeting(now, town.timezone)} · ${new Intl.DateTimeFormat('en-US', {
        timeZone: town.timezone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }).format(now)}`}
    />
  );
  const capsules = <CategoryCapsules town={town} />;

  // heritage: lead in the center, the modules before it on the left and after it on the right,
  // divided by column rules. Other families: the first module wide, the rest beside it.
  const leadAt = split.indexOf('lead-story');
  const threeColumn = theme.family === 'heritage' && leadAt > 0;
  const nodeList = (items: typeof topNodes, ctaAfterFirst: boolean) =>
    items.map(({ key, node }, i) =>
      node === null ? null : (
        <Fragment key={key}>
          {node}
          {i === 0 && ctaAfterFirst && bandCta ? (
            <div className="mobile-only">{bandCta}</div>
          ) : null}
        </Fragment>
      ),
    );

  const band =
    top.length > 0 ? (
      <>
        {phoneTitle}
        {capsules}
        {hello}
        {quick}
        <Slot town={town} name="home.top" />
        {spanning}
        {threeColumn ? (
          <div className={styles.band3} data-band="three-column">
            <div className={styles.bandCol} data-band-col="side">
              {nodeList(topNodes.slice(0, leadAt), true)}
            </div>
            <div className={styles.bandCol} data-band-col="main">
              {topNodes[leadAt]!.node}
            </div>
            <div className={styles.bandCol} data-band-col="side">
              {nodeList(topNodes.slice(leadAt + 1), false)}
            </div>
          </div>
        ) : (
          <div className={styles.band}>
            {topNodes[0]?.node != null ? (
              <div className={styles.bandMain} data-band-col="main">
                {topNodes[0].node}
              </div>
            ) : null}
            {bandCta ? <div className="mobile-only">{bandCta}</div> : null}
            {topNodes.slice(1).some(({ node }) => node !== null) ? (
              <div className={styles.bandSide} data-band-col="side">
                {nodeList(topNodes.slice(1), false)}
              </div>
            ) : null}
          </div>
        )}
      </>
    ) : null;

  return (
    <TownGrid
      town={town}
      kind={theme.layout.grid}
      top={
        band ?? (
          <>
            {phoneTitle}
            {capsules}
          </>
        )
      }
      bottom={
        bottomNodes.length > 0
          ? bottomNodes.map(({ key, node }) => <Fragment key={key}>{node}</Fragment>)
          : null
      }
      railModules={railNodes.length > 0 ? railNodes : null}
    >
      <ListBeacon />
      <HomeScreenCard townName={town.name} />
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
