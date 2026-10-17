import type { HomeModule } from '@towncore/config';

// The homepage's module order (§11a-2), apart from the module components so it can be tested.

/**
 * Modules that are navigation or a greeting, not content: they span the top band and don't
 * count toward "newsletter-cta among the first two modules on mobile".
 */
export const SPANNING_MODULES = new Set<HomeModule>([
  'good-morning',
  'category-buttons',
  'quick-links',
]);

const contentIndex = (list: readonly HomeModule[], module: HomeModule) =>
  list.filter((m) => !SPANNING_MODULES.has(m)).indexOf(module);

/**
 * The order to render the main column: the theme's list, with newsletter-cta guaranteed among
 * the first two modules on mobile. With a full-width top band (homeTop), the band's first module
 * counts as the first, so the CTA is added mobile-only right after it.
 *
 * `signupFirst` is the `module-order` experiment (owner, 2026-10-17): on phones the CTA comes
 * first and the first module second. Desktop is unchanged, and the first three modules stay the
 * same set, so the neighbor rule (§11a-2) holds.
 */
export function homeOrder(
  list: readonly HomeModule[],
  top: readonly HomeModule[] = [],
  signupFirst = false,
): Array<{ module: HomeModule; mobileOnly: boolean; desktopOnly?: boolean }> {
  const order: Array<{ module: HomeModule; mobileOnly: boolean; desktopOnly?: boolean }> = list.map(
    (module) => ({ module, mobileOnly: false }),
  );
  const position = contentIndex([...top, ...list], 'newsletter-cta');
  if (position === 0) return order;
  if (top.length > 0) return order; // the page inserts it into the band (see topBand).
  if (position === 1) {
    if (!signupFirst) return order;
    const at = order.findIndex((o) => o.module === 'newsletter-cta');
    order[at] = { module: 'newsletter-cta', mobileOnly: false, desktopOnly: true };
  }
  order.splice(signupFirst ? 0 : 1, 0, { module: 'newsletter-cta', mobileOnly: true });
  return order;
}

/** Whether the top band needs a mobile-only newsletter CTA after its first module. */
export function bandNeedsCta(list: readonly HomeModule[], top: readonly HomeModule[]): boolean {
  if (top.length === 0) return false;
  const position = contentIndex([...top, ...list], 'newsletter-cta');
  return position !== 0 && position !== 1;
}
