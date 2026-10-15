import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { getTownBySlug, type Db } from '@towncore/db';
import { applyImport, parseImportList, planImport } from '../bulk/admin';

// pnpm mail:import --town <slug> --file <list.csv> --consent-source "<how they opted in>"
//   [--approved-by <admin email>]
// Brief §7.3: every import needs the owner's approval and a stated consent source. Without
// --approved-by it only reports what it would do (Rule 10: dry run by default).

const USAGE =
  'Usage: pnpm mail:import --town <slug> --file <list.csv> --consent-source "<how they opted in>" [--approved-by <admin email>]';

export async function runImportCommand(
  argv: string[],
  deps: { db: Db; out: (line: string) => void; read?: (path: string) => Promise<string> },
): Promise<number> {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        town: { type: 'string' },
        file: { type: 'string' },
        'consent-source': { type: 'string' },
        'approved-by': { type: 'string' },
      },
    }) as { values: Record<string, string | undefined> });
  } catch (error) {
    deps.out(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const { town: slug, file } = values;
  const consent = values['consent-source'];
  if (!slug || !file || !consent) {
    deps.out(USAGE);
    return 2;
  }
  const town = await getTownBySlug(deps.db, slug);
  if (!town) {
    deps.out(`No town with slug ${slug}.`);
    return 1;
  }
  const text = await (deps.read ?? ((p) => readFile(p, 'utf8')))(file);
  const plan = await planImport(deps.db, town.id, parseImportList(text));
  deps.out(
    `${town.siteName}: ${plan.add.length} to add, ${plan.existing.length} already on the list (left as they are), ${plan.invalid.length} invalid.`,
  );
  for (const bad of plan.invalid.slice(0, 20)) deps.out(`  invalid: ${bad}`);
  const approver = values['approved-by'];
  if (!approver) {
    deps.out(
      'Dry run: nothing was imported. Add --approved-by <admin email> once the owner approves this list.',
    );
    return 0;
  }
  try {
    const added = await applyImport(deps.db, {
      townId: town.id,
      plan,
      consentSource: consent,
      approvedByEmail: approver,
    });
    deps.out(
      `Imported ${added} subscriber(s), approved by ${approver}. Consent source: ${consent}`,
    );
    return 0;
  } catch (error) {
    deps.out((error as Error).message);
    return 1;
  }
}
