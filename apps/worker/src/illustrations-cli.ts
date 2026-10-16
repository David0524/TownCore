// pnpm illustrations shotlist
//   Writes docs/brand/illustration-shot-list.md from packages/config/src/illustrations.ts.
// pnpm illustrations import <dir> --approved-by <email> --alt <alts.json>
//   Imports images named by shot ID (gov-01.png …) into apps/web/public/illustrations/ and the
//   library, with alt text from alts.json ({ "gov-01": "…" }), written from what each shows.
// pnpm illustrations assign [town-slug]
//   Gives stories that only have a title card a section illustration, if one fits.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { illustrationLibrary, requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, getTownBySlug } from '@towncore/db';
import {
  assignIllustrations,
  formatWithPrettier,
  importIllustrations,
  librarySource,
  shotListMarkdown,
} from './illustrations';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};

if (command === 'shotlist') {
  const file = join(root, 'docs/brand/illustration-shot-list.md');
  await writeFile(file, shotListMarkdown());
  formatWithPrettier(root, [file]);
  console.log(`wrote ${file}`);
} else if (command === 'import') {
  const dir = rest[0];
  const approvedBy = flag('approved-by');
  const altFile = flag('alt');
  if (!dir || dir.startsWith('--') || !approvedBy || !altFile) {
    throw new Error(
      'usage: pnpm illustrations import <dir> --approved-by <email> --alt <alts.json>',
    );
  }
  const webDir = join(root, 'apps/web/public/illustrations');
  await mkdir(webDir, { recursive: true });
  const { result, library } = await importIllustrations({
    dir,
    alts: JSON.parse(await readFile(altFile, 'utf8')) as Record<string, string>,
    approvedBy,
    library: illustrationLibrary,
    webDir,
  });
  const libraryFile = join(root, 'packages/config/src/illustrations-library.ts');
  await writeFile(libraryFile, librarySource(library));
  formatWithPrettier(root, [libraryFile]);
  console.log(`imported ${result.imported.length}: ${result.imported.join(', ') || 'none'}`);
  for (const s of result.skipped) console.log(`skipped ${s.file}: ${s.why}`);
  console.log(`library: ${library.length} illustrations`);
} else if (command === 'assign') {
  loadDotEnv();
  const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
  try {
    const slug = rest[0];
    const town = slug ? await getTownBySlug(db, slug) : null;
    if (slug && !town) throw new Error(`unknown town: ${slug}`);
    console.log('illustrations:', await assignIllustrations(db, { townId: town?.id }));
  } finally {
    await db.$client.end();
  }
} else {
  throw new Error('usage: pnpm illustrations <shotlist|import|assign> …');
}
