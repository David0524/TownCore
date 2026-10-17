import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Theme, TownConfig } from '@towncore/config';
import { LOGO_PROMPTS, logoArtPrompt } from '@towncore/photos';

// Launch step 6b, logo art (owner, 2026-10-17: "We will do ChatGPT image prompts for now. So
// when I start a new town you will provide the prompt."). After the theme, three ready-to-paste
// ChatGPT image prompts in Boca's style go into logo-prompt.md next to the report; the owner
// makes the image and runs `pnpm identity import`, which cuts the hero and icons in code. No
// image service is called. Until then the town keeps the masthead and motif icons drawn in code.

export type ArtDetail = {
  /** logo-prompt.md, with the three prompts. */
  promptFile: string;
  prompts: string[];
  /** Art already imported (the town's YAML has hero_art and app_icon). */
  imported: boolean;
};

export function logoPromptStep(input: {
  config: TownConfig;
  theme: Theme;
  place: { name: string; state: string };
  dir: string;
}): ArtDetail {
  const { config, theme } = input;
  const prompts = Array.from({ length: LOGO_PROMPTS }, (_, i) =>
    logoArtPrompt(
      {
        town: input.place.name,
        state: input.place.state,
        family: theme.family,
        palette: theme.palette,
        motif: theme.motif,
        identityNotes: theme.identityNotes,
      },
      i + 1,
    ),
  );
  const promptFile = join(input.dir, 'logo-prompt.md');
  writeFileSync(
    promptFile,
    `# Logo art for ${config.site_name}

Paste one prompt into ChatGPT (image generation), landscape output. Make as many as you like and
keep the one you prefer. Then import it; code cuts the homepage art, icons, favicon, avatar,
share, cover and email header from it:

\`\`\`
pnpm identity import ${config.slug} <the image file> --approved-by you@towncore.net
\`\`\`

The site name is set in code, so the image must have no text. Check it shows no real building
copied as the town's own, no seal or official logo, and no people.

${prompts.map((p, i) => `## ${i === 0 ? 'Prompt' : `Alternate ${i}`}\n\n\`\`\`text\n${p}\n\`\`\``).join('\n\n')}
`,
  );
  return { promptFile, prompts, imported: Boolean(config.hero_art && config.app_icon) };
}
