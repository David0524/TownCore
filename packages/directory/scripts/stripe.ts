// pnpm directory:stripe sync [--town <slug>] [--execute]
// Plans one Stripe Product and monthly Price per town and enabled product, from each town's
// pricing (D-M6-6). A dry run by default: it prints the plan and changes nothing. --execute
// creates what's missing in Stripe, with a test-mode key only (D-M6-5).
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { applyPricePlan, offerName, planPrices, stripeClient } from '../src';

loadDotEnv();
const args = process.argv.slice(2);
if (args[0] !== 'sync')
  throw new Error('usage: pnpm directory:stripe sync [--town <slug>] [--execute]');
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
