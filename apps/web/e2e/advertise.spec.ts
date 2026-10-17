import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loadEnv } from '@towncore/config';
import {
  and,
  businesses,
  createDb,
  eq,
  inArray,
  like,
  ownerSessions,
  placements,
  towns,
} from '@towncore/db';

// The advertise storefront (owner, 2026-10-17: "a full build out of the advertise page… working
// in full. Let's install Stripe on the site"), on all three families: the category chooser, a
// button on every open featured spot, the offer cards, and /advertise/start for a visitor (find
// and claim first) and a signed-in owner (straight to Checkout, the local fake Stripe in
// e2e/fake-stripe.mjs; nothing reaches Stripe). Each project uses categories no other spec does.

// Never closed: with fullyParallel a worker can run more of this file's tests after its
// afterAll, so the client stays open; idle connections close by themselves.
const db = createDb(loadEnv().DATABASE_URL!, { max: 1, idle_timeout: 5 });
const fakeStripe = 'http://127.0.0.1:3199';
const SOURCE = 'test-advertise';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

const TOWNS = [
  { slug: 'boca-raton', host: 'http://bocatownsquare.com' },
  { slug: 'harbor-point', host: 'http://harborpoint.test' },
  { slug: 'pine-hollow', host: 'http://pinehollow.test' },
] as const;
type TownSlug = (typeof TOWNS)[number]['slug'];

const CATEGORIES: Record<'desktop' | 'mobile', Record<TownSlug, string>> = {
  desktop: {
    'boca-raton': 'professional-services',
    'harbor-point': 'general-contractors',
    'pine-hollow': 'health-and-medical',
  },
  mobile: {
    'boca-raton': 'real-estate',
    'harbor-point': 'caterers',
    'pine-hollow': 'grocery-and-markets',
  },
};
const categoryFor = (project: string, town: TownSlug) =>
  CATEGORIES[project === 'mobile' ? 'mobile' : 'desktop'][town];

async function townId(slug: string) {
  const [town] = await db.select().from(towns).where(eq(towns.slug, slug));
  return town!.id;
}

/** Two listings of our own in the category; the first one claimed by `email` when given. */
async function seed(town: TownSlug, category: string, project: string, email?: string) {
  const id = await townId(town);
  const prefix = `adv-${project}-${category}`;
  await cleanup(id, prefix);
  return db
    .insert(businesses)
    .values(
      [1, 2].map((i) => ({
        townId: id,
        slug: `${prefix}-${i}`,
        name: `Storefront Test ${project} ${i}`,
        category,
        licenseVerified: true,
        dataSource: SOURCE,
        active: true,
        ...(email && i === 1 ? { claimedAt: new Date(), claimedByEmail: email } : {}),
      })),
    )
    .returning();
}

/** Removes this spec's listings (by their slug prefix) and anything booked for them. */
async function cleanup(id: string, prefix: string) {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.townId, id),
        eq(businesses.dataSource, SOURCE),
        like(businesses.slug, `${prefix}-%`),
      ),
    );
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  await db.delete(placements).where(inArray(placements.businessId, ids));
  await db.delete(businesses).where(inArray(businesses.id, ids));
}

async function signIn(context: BrowserContext, id: string, host: string, email: string) {
  const token = randomBytes(24).toString('base64url');
  await db.insert(ownerSessions).values({
    townId: id,
    email,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await context.addCookies([{ name: 'tc_owner', value: token, url: `${host}/` }]);
}

type FakeSession = {
  id: string;
  params: Record<string, unknown> & { metadata: Record<string, string> };
};
async function lastSession(email: string): Promise<FakeSession> {
  const all = (await (await fetch(`${fakeStripe}/__sessions`)).json()) as FakeSession[];
  return all.filter((s) => s.params.customer_email === email).at(-1)!;
}

/** Ad units' share of the page's height, and the page's layout shift. */
async function adDensity(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ density: number; cls: number }>((resolve) => {
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { value: number; hadRecentInput: boolean }
          >)
            if (!entry.hadRecentInput) cls += entry.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => {
          const slots = [...document.querySelectorAll('[data-slot]')].filter(
            (el) => (el as HTMLElement).offsetParent !== null,
          );
          const height = slots.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
          resolve({ density: height / document.documentElement.scrollHeight, cls });
        }, 1000);
      }),
  );
}

for (const { slug, host } of TOWNS) {
  test(`${slug}: the storefront lists categories, sells open spots and leads to the start page`, async ({
    page,
    isMobile,
  }, info) => {
    const category = categoryFor(info.project.name, slug);
    const listings = await seed(slug, category, info.project.name);
    const id = await townId(slug);

    await page.goto(`${host}/advertise`);
    const chooser = page.getByTestId('category-chooser');
    await expect(chooser.getByRole('heading', { name: 'Pick your category' })).toBeVisible();
    const choice = chooser.getByTestId(`choose-${category}`);
    await expect(choice).toContainText('2 places');
    await expect(choice).toContainText('3 of 3 open');
    // Every fixture town and Boca sell #3 at $7.
    await expect(choice).toContainText('From $7 a month');
    // Without a category, the spots ask for one first.
    await expect(page.getByTestId('tier-1')).toContainText('Pick a category first');
    // The other offers, each with its own start link.
    for (const product of ['enhanced', 'newsletter', 'exclusive'])
      await expect(
        page.getByTestId(`offer-${product}`).getByRole('link', { name: 'Get started' }),
      ).toHaveAttribute('href', new RegExp(`^/advertise/start\\?product=${product}`));
    await expect(page.getByTestId('offer-newsletter')).toContainText('a week');

    await choice.click();
    await expect(page).toHaveURL(new RegExp(`/advertise\\?category=${category}#spots$`));
    await expect(page.getByTestId('advertise-category')).toContainText('#1, #2, #3 open');
    const get1 = page.getByTestId('tier-1').getByRole('link', { name: 'Get spot #1' });
    await expect(get1).toHaveAttribute(
      'href',
      `/advertise/start?product=sponsored_slot&category=${category}&rank=1`,
    );
    await expect(
      page.getByTestId('tier-premium').getByRole('link', { name: 'Get started' }),
    ).toHaveAttribute('href', `/advertise/start?product=exclusive&category=${category}`);
    // Measured on a fresh load: layout shift counts the whole visit, client navigation included.
    await page.goto(`${host}/advertise?category=${category}`);
    const spots = await adDensity(page);
    expect(spots.cls).toBeLessThan(0.1);
    if (isMobile) expect(spots.density).toBeLessThanOrEqual(0.3);

    // A sold spot says Taken, without a button.
    await db.insert(placements).values({
      businessId: listings[1]!.id,
      townId: id,
      product: 'sponsored_slot',
      category,
      rank: 2,
      status: 'active',
      startsAt: new Date(),
    });
    await page.reload();
    await expect(page.getByTestId('tier-2')).toContainText('Taken');
    await expect(page.getByTestId('tier-2').getByRole('link')).toHaveCount(0);

    // A visitor who isn't signed in finds their business and claims it first.
    await get1.click();
    await expect(page).toHaveURL(/\/advertise\/start\?/);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toContainText('Featured spot #1 in');
    await expect(page.getByTestId('start-summary')).toContainText('first 30 days are free');
    await expect(main).toContainText('never changes the order of other listings');
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    const find = page.getByTestId('start-find');
    await expect(find.getByRole('link', { name: 'Sign in to your owner page' })).toHaveAttribute(
      'href',
      '/owner',
    );
    await expect(find.getByRole('link', { name: 'Add it' })).toHaveAttribute(
      'href',
      '/directory/add',
    );
    await find.getByRole('searchbox', { name: 'Business name' }).fill('Storefront Test');
    await find.getByRole('button', { name: 'Find it' }).click();
    const results = page.getByTestId('start-results');
    await expect(results.getByRole('listitem')).toHaveCount(2);
    await expect(results.getByRole('link', { name: 'Claim' }).first()).toHaveAttribute(
      'href',
      /^\/directory\/claim\/adv-/,
    );
    const start = await adDensity(page);
    expect(start.cls).toBeLessThan(0.1);
    if (isMobile) expect(start.density).toBeLessThanOrEqual(0.3);

    await cleanup(id, `adv-${info.project.name}-${category}`);
  });
}

test('a signed-in owner goes from a spot straight to Stripe Checkout', async ({
  page,
  context,
}, info) => {
  // Not the storefront test's category, which expects every spot open.
  const category = info.project.name === 'mobile' ? 'food-trucks' : 'bars-and-nightlife';
  const email = `owner-${info.project.name}@storefront.test`;
  const [listing, other] = await seed('harbor-point', category, info.project.name, email);
  const id = await townId('harbor-point');
  // The second listing is in another category no Harbor Point spec uses: it can't buy this spot.
  await db
    .update(businesses)
    .set({
      claimedAt: new Date(),
      claimedByEmail: email,
      category: info.project.name === 'mobile' ? 'personal-services' : 'banks-and-finance',
    })
    .where(eq(businesses.id, other!.id));
  await signIn(context, id, 'http://harborpoint.test', email);

  await page.goto(
    `http://harborpoint.test/advertise/start?product=sponsored_slot&category=${category}&rank=1`,
  );
  const owner = page.getByTestId('start-owner');
  await expect(owner).toContainText(`Signed in as ${email}`);
  await expect(owner.getByTestId('start-listing')).toHaveCount(1);
  await expect(owner.getByTestId('start-listing')).toContainText(listing!.name);
  await owner.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
  const session = await lastSession(email);
  expect(session.params).toMatchObject({
    mode: 'subscription',
    subscription_data: { trial_period_days: '30' },
    metadata: { product: 'sponsored_slot', rank: '1', category },
    success_url: `http://harborpoint.test/owner/${listing!.slug}?s=paid`,
    cancel_url: `http://harborpoint.test/owner/${listing!.slug}?s=canceled`,
  });
  // The Checkout holds the spot: the storefront shows it taken.
  await page.goto(`http://harborpoint.test/advertise?category=${category}`);
  await expect(page.getByTestId('tier-1')).toContainText('Taken');

  // Back from Stripe: the owner page says what happens next.
  await page.goto(`http://harborpoint.test/owner/${listing!.slug}?s=paid`);
  await expect(page.getByTestId('owner-payment')).toContainText('turns on in a moment');
  await page.goto(`http://harborpoint.test/owner/${listing!.slug}?s=canceled`);
  await expect(page.getByTestId('owner-payment')).toContainText('nothing was charged');

  await cleanup(id, `adv-${info.project.name}-${category}`);
});

test('Boca: the morning email offers its open weeks and books one through Checkout', async ({
  page,
  context,
}, info) => {
  const category = info.project.name === 'mobile' ? 'fitness' : 'automotive';
  const email = `weeks-${info.project.name}@storefront.test`;
  const [listing] = await seed('boca-raton', category, info.project.name, email);
  const id = await townId('boca-raton');
  await signIn(context, id, 'http://bocatownsquare.com', email);

  await page.goto('http://bocatownsquare.com/advertise');
  await page.getByTestId('offer-newsletter').getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/advertise\/start\?product=newsletter$/);
  await expect(page.getByTestId('start-price')).toContainText('$45 for one week, paid once');
  const owner = page.getByTestId('start-owner');
  const select = owner.getByRole('combobox', { name: 'Week' });
  const options = await select
    .locator('option')
    .evaluateAll((o) =>
      o.map((x) => ({ value: (x as HTMLOptionElement).value, label: x.textContent })),
    );
  expect(options.length).toBeGreaterThan(3);
  expect(options[0]!.label).toMatch(/^Week of /);
  // Each project books a different week.
  const week = options[info.project.name === 'mobile' ? 3 : 2]!.value;
  await select.selectOption(week);
  await owner.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
  const session = await lastSession(email);
  expect(session.params).toMatchObject({
    mode: 'payment',
    metadata: { product: 'newsletter', period: week, business_id: listing!.id },
    line_items: [{ price_data: { unit_amount: '4500' } }],
  });

  // That week is now held: asked for again, the next open one is offered.
  await page.goto(`http://bocatownsquare.com/advertise/start?product=newsletter&period=${week}`);
  await expect(page.getByTestId('start-period-taken')).toContainText('That week is booked');
  await cleanup(id, `adv-${info.project.name}-${category}`);
});
