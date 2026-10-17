// pnpm identity import <town-slug> <image> --approved-by <email> [--region left,top,width,height]
//   Imports the logo art the owner made in ChatGPT (from the prompts in the launch report's
//   logo-prompt.md): cuts the hero, icons, favicon, avatar, share, cover and email header images
//   into apps/web/public/brand/<slug>/, sets hero_art and app_icon in the town's YAML and config,
//   and records the art as AI-generated with its approver. --region cuts the art out of a larger
//   image first (a logo that has its name under the art, like Boca's).
// pnpm identity prompt <town-slug>
//   Prints the three ChatGPT prompts for a town already in the database.
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireEnv, type Theme } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { createDb, getTownBySlug } from '@towncore/db';
import { importIdentityArt, IdentityImportError, LOGO_PROMPTS, logoArtPrompt } from '../src';

loadDotEnv();
const root = fileURLToPath(new URL('../../../', import.meta.url));
const [command, slug, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};
const usage =
  'Usage: pnpm identity import <town-slug> <image> --approved-by <email> [--region l,t,w,h]\n       pnpm identity prompt <town-slug>';

/** The town's YAML: under towns/ once live, else in its launch folder. */
function townFile(slug: string): string | undefined {
  const find = (dir: string): string | undefined => {
    if (!existsSync(dir)) return undefined;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = find(path);
        if (found) return found;
      } else if (entry.name === `${slug}.yaml`) return path;
    }
    return undefined;
  };
  return find(join(root, 'towns')) ?? find(join(root, 'docs', 'launches', slug, 'town'));
}

if (!slug || !['import', 'prompt'].includes(command ?? '')) {
  console.error(usage);
  process.exit(1);
}
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });
try {
  if (command === 'prompt') {
    const town = await getTownBySlug(db, slug);
    if (!town?.theme) throw new IdentityImportError(`No town ${slug} with a theme.`);
    const theme = town.theme as Theme;
    for (let option = 1; option <= LOGO_PROMPTS; option++)
      console.log(
        `--- Option ${option}\n${logoArtPrompt({ town: town.name, state: town.state, family: theme.family, palette: theme.palette, motif: theme.motif, identityNotes: theme.identityNotes }, option)}\n`,
      );
  } else {
    const image = rest.find((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
    const approvedBy = flag('approved-by');
    if (!image || !approvedBy) throw new IdentityImportError(usage);
    const region = flag('region')?.split(',').map(Number);
    if (region && (region.length !== 4 || region.some((n) => !Number.isInteger(n) || n < 0)))
      throw new IdentityImportError('--region takes left,top,width,height in pixels.');
    // Relative paths are from the repository root, where `pnpm identity` is run.
    const file = isAbsolute(image) ? image : resolve(root, image);
    const yaml = townFile(slug);
    const { config } = await importIdentityArt(db, {
      slug,
      file,
      approvedBy,
      publicDir: join(root, 'apps', 'web', 'public'),
      ...(yaml ? { townFile: yaml } : {}),
      ...(region
        ? { region: { left: region[0]!, top: region[1]!, width: region[2]!, height: region[3]! } }
        : {}),
    });
    console.log(`Cut ${slug}'s identity assets into apps/web/public${config.app_icon}/`);
    console.log(
      yaml
        ? `Set hero_art and app_icon in ${yaml.slice(root.length)}`
        : 'No town YAML found: add hero_art and app_icon to it by hand.',
    );
  }
} catch (error) {
  if (error instanceof IdentityImportError) {
    console.error(error.message);
    process.exitCode = 1;
  } else throw error;
} finally {
  await db.$client.end();
}
