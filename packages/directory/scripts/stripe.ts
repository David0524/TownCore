// pnpm directory:stripe sync [--town <slug>] [--execute]
// Plans one Stripe Product and monthly Price per town and enabled product, from each town's
// pricing (D-M6-6). A dry run by default: it prints the plan and changes nothing. --execute
// creates what's missing in Stripe, with a test-mode key only (D-M6-5).
//
// pnpm directory:stripe check
// Read-only: checks the test-mode key, the account, the webhook endpoint and its events, the
// webhook secret (set or not, never printed), the Customer Portal and the price plan, as a
// checklist. Exits non-zero when anything is missing.
import { loadEnv, requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import {
  applyPricePlan,
  checkStripeSetup,
  isLiveKey,
  offerName,
  planPrices,
  stripeClient,
} from '../src';

loadDotEnv();
const args = process.argv.slice(2);
if (args[0] !== 'sync' && args[0] !== 'check')
  throw new Error('usage: pnpm directory:stripe sync [--town <slug>] [--execute] | check');

if (args[0] === 'check') {
  const env = loadEnv();
  const key = env.STRIPE_SECRET_KEY;
  const db = env.DATABASE_URL ? createDb(env.DATABASE_URL, { max: 1 }) : null;
  try {
    const items = await checkStripeSetup({
      db,
      // A live key never gets a client (stripeClient refuses it); the check reports it instead.
      stripe: key && !isLiveKey(key) ? stripeClient(key, env.STRIPE_API_BASE) : null,
      secretKey: key,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      appBaseUrl: env.APP_BASE_URL,
    });
    console.log('Stripe (test mode) for the directory:\n');
    for (const item of items) {
      console.log(`  [${item.ok ? 'x' : ' '}] ${item.label}`);
      if (item.detail) console.log(`      ${item.detail}`);
    }
    const missing = items.filter((i) => !i.ok).length;
    console.log(missing ? `\n${missing} item(s) to fix.` : '\nAll set.');
    if (missing) process.exitCode = 1;
  } finally {
    await db?.$client.end();
  }
} else {
  const townIndex = args.indexOf('--town');
  const towns = townIndex >= 0 && args[townIndex + 1] ? [args[townIndex + 1]!] : undefined;
  const execute = args.includes('--execute');

  const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
  try {
    const plan = await planPrices(db, towns);
    for (const item of plan) {
      console.log(
        `${item.action === 'create' ? 'CREATE ' : 'current'}  ${item.town.slug}  ${offerName(item.product, item.rank)}  $${item.amountCents / 100}/month  (${item.lookupKey})`,
      );
    }
    const missing = plan.filter((p) => p.action === 'create').length;
    if (!execute) {
      console.log(
        `\nDry run: ${missing} price(s) to create. Run with --execute to create them in Stripe.`,
      );
    } else if (missing > 0) {
      const stripe = stripeClient(requireEnv('STRIPE_SECRET_KEY'))!;
      for (const { item, priceId } of await applyPricePlan(db, stripe, plan))
        console.log(`created ${item.town.slug} ${item.product}: ${priceId}`);
    } else {
      console.log('\nEverything is current.');
    }
  } finally {
    await db.$client.end();
  }
}
