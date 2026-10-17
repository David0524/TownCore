import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTheme, parseTownConfig } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { logoPromptStep } from '../src';

// Step 6b's logo art (owner, 2026-10-17: "when I start a new town you will provide the prompt"):
// three ChatGPT prompts in logo-prompt.md next to the report, and the import command to run.

const fixtures = fileURLToPath(new URL('../../../apps/web/e2e/fixtures/towns/me', import.meta.url));
const config = parseTownConfig(readFileSync(join(fixtures, 'harbor-point.yaml'), 'utf8'));
const theme = parseTheme(readFileSync(join(fixtures, 'harbor-point.theme.json'), 'utf8'));

describe('logo art prompts in a launch', () => {
  it('writes three ready-to-paste prompts from the theme and the import command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-art-'));
    const art = logoPromptStep({
      config,
      theme,
      place: { name: 'Harbor Point', state: 'ME' },
      dir,
    });
    expect(art.prompts).toHaveLength(3);
    expect(art.imported).toBe(false);
    const file = readFileSync(art.promptFile, 'utf8');
    expect(art.promptFile).toBe(join(dir, 'logo-prompt.md'));
    expect(file).toContain('pnpm identity import harbor-point <the image file>');
    for (const prompt of art.prompts) expect(file).toContain(prompt);
    expect(art.prompts[0]).toContain(theme.palette.accent);
    expect(art.prompts[0]).toContain('Harbor Point, ME');
  });

  it('knows when art was imported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-art-'));
    const art = logoPromptStep({
      config: {
        ...config,
        hero_art: { src: '/brand/harbor-point/hero.webp', width: 1221, height: 407 },
        app_icon: '/brand/harbor-point',
      },
      theme,
      place: { name: 'Harbor Point', state: 'ME' },
      dir,
    });
    expect(art.imported).toBe(true);
  });
});
