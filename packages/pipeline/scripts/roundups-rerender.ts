// pnpm roundups:rerender <town-slug> [--apply]: rebuilds the town's code-built roundups from their
// records with the current templates and rewrites them in place (same address, published date
// unchanged). A dry run by default: it prints what would change. Our own database only.
import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb } from '@towncore/db';
import { rerenderRoundups } from '../src';

loadDotEnv();
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) throw new Error('usage: pnpm roundups:rerender <town-slug> [--dry-run | --apply]');
const apply = args.includes('--apply') && !args.includes('--dry-run');
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const { checked, changes } = await rerenderRoundups(db, slug, { apply });
  for (const c of changes) {
    console.log(`\n${c.slug} (${c.status})`);
    if (c.before.headline !== c.after.headline) {
      console.log(`  headline: ${c.before.headline}`);
      console.log(`        → ${c.after.headline}`);
    }
    if (c.before.dek !== c.after.dek) console.log(`  dek: → ${c.after.dek}`);
    if (c.before.bodyMd !== c.after.bodyMd)
      console.log(
        `  body: ${c.before.bodyMd.length} → ${c.after.bodyMd.length} characters; opens "${c.after.bodyMd.split('\n')[0]!.slice(0, 120)}"`,
      );
  }
  console.log(
    `\n${checked} code-built roundup(s) checked; ${changes.length} ${apply ? 'rewritten' : 'would change (dry run; pass --apply to write)'}.`,
  );
} finally {
  await db.$client.end();
}
