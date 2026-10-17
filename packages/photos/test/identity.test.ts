import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTownConfig } from '@towncore/config';
import { adminActions, eq, identityArt, staff, towns, type Db } from '@towncore/db';
import { createTestDb } from '@towncore/db/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deriveIdentityAssets,
  IDENTITY_FILES,
  importIdentityArt,
  LOGO_RULES,
  logoArtPrompt,
  logoInputProblems,
  placeholderLogoArt,
  type LogoArtInput,
} from '../src/identity-index';

// Logo art for every town (owner, 2026-10-17): the ChatGPT prompts in Boca's style with the
// owner's limits, every asset cut from the art (Boca's logo file reproduces Boca's hand-made
// set), and the import recorded with the person who approved it.

const art: LogoArtInput = {
  town: 'Harbor Point',
  state: 'ME',
  family: 'heritage',
  palette: { accent: '#0F4C5C', ink: '#1A1A1A', tint: '#E9EFF0' },
  motif: 'lighthouse',
  identityNotes: 'Granite coast, lobster boats and a white lighthouse on the point.',
};
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const bocaDir = join(repo, 'apps/web/public/brand/boca-raton');
const bocaLogo = join(repo, 'docs/brand/boca-town-square-logo.webp');
/** The art above Boca's wordmark in its logo file. */
const bocaArt = { left: 0, top: 0, width: 1400, height: 415 };

describe('logo art prompts', () => {
  it('describe Boca’s style, carry every limit, and differ only in what leads the scene', () => {
    const prompts = [1, 2, 3].map((n) => logoArtPrompt(art, n));
    for (const rule of LOGO_RULES) expect(prompts[0]).toContain(rule);
    expect(prompts[0]).toContain('flat, bright vector-style illustration');
    expect(prompts[0]).toContain('about 3:1');
    expect(prompts[0]).toContain('Tall foreground trees frame the scene');
    // The art's left half becomes the Home Screen app icon.
    expect(prompts[0]).toContain('becomes the phone app icon');
    expect(prompts[0]).toContain('pure white background');
    expect(prompts[0]).toContain('Harbor Point, ME');
    expect(prompts[0]).toContain('#0F4C5C');
    expect(prompts[0]).toContain('lighthouse');
    expect(new Set(prompts).size).toBe(3);
  });

  it('refuse inputs that would look official or ask for text', () => {
    expect(logoInputProblems(art)).toEqual([]);
    expect(logoInputProblems({ ...art, identityNotes: 'The city seal over the harbor.' })).toEqual([
      'identity notes mention "seal": logo art never looks official',
    ]);
    expect(
      logoInputProblems({ ...art, identityNotes: 'Write "Harbor Point" across the sky.' }),
    ).toHaveLength(1);
    expect(() => logoArtPrompt({ ...art, identityNotes: 'Official town crest' }, 1)).toThrow(
      /refused/,
    );
  });
});

describe('identity assets', () => {
  it('cut from Boca’s logo file, match Boca’s hand-made set in names, sizes and formats', async () => {
    const assets = await deriveIdentityAssets(new Uint8Array(readFileSync(bocaLogo)), bocaArt);
    expect(Object.keys(assets).sort()).toEqual([...IDENTITY_FILES].sort());
    // Every file of Boca's set except the wordmark, which is set in code.
    const reference = readdirSync(bocaDir).filter((f) => f !== 'wordmark.webp');
    expect(reference.length).toBe(6);
    for (const file of reference) {
      const theirs = await sharp(readFileSync(join(bocaDir, file))).metadata();
      const ours = await sharp(assets[file as keyof typeof assets].bytes).metadata();
      expect([ours.format, ours.width, ours.height, ours.hasAlpha], file).toEqual([
        theirs.format,
        theirs.width,
        theirs.height,
        theirs.hasAlpha,
      ]);
    }
    // The hero's background is cut away; the white walls inside the scene are not.
    const { data, info } = await sharp(assets['hero.webp'].bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(data[(info.width * info.height - 1) * 4 + 3]).toBeLessThan(255);
    expect(
      [
        assets['share-default.png'],
        assets['social-avatar.png'],
        assets['newsletter-header.png'],
        assets['facebook-cover.png'],
      ].map((a) => [a.width, a.height]),
    ).toEqual([
      [1200, 630],
      [512, 512],
      [600, 120],
      [1640, 624],
    ]);
  });

  it('cut a ChatGPT-style image with no wordmark the same way', async () => {
    const assets = await deriveIdentityAssets(await placeholderLogoArt(art));
    expect([assets['hero.webp'].width, assets['hero.webp'].height]).toEqual([1221, 407]);
    expect((await sharp(assets['icon-32.png'].bytes).metadata()).hasAlpha).toBe(true);
  });
});

describe('importing logo art', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const dir = mkdtempSync(join(tmpdir(), 'identity-'));
  const townFile = join(dir, 'harbor-point.yaml');
  const image = join(dir, 'ChatGPT Image.png');

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    copyFileSync(join(repo, 'apps/web/e2e/fixtures/towns/me/harbor-point.yaml'), townFile);
    writeFileSync(image, await placeholderLogoArt(art));
    await db.insert(towns).values({
      slug: 'harbor-point',
      name: 'Harbor Point',
      state: 'ME',
      county: 'Fictional',
      timezone: 'America/New_York',
      domain: 'harborpoint.test',
      siteName: 'The Harbor Point Ledger',
      tier: 'small',
      config: { slug: 'harbor-point' },
    });
    await db.insert(staff).values([
      { email: 'owner@towncore.net', name: 'Owner', role: 'admin' },
      { email: 'gone@towncore.net', name: 'Gone', role: 'reviewer', active: false },
    ]);
  });
  afterAll(async () => drop());

  const run = (approvedBy: string, file = image) =>
    importIdentityArt(db, {
      slug: 'harbor-point',
      file,
      approvedBy,
      publicDir: join(dir, 'public'),
      townFile,
    });

  it('needs an active staff member and a real, large enough image', async () => {
    await expect(run('gone@towncore.net')).rejects.toThrow(/active staff/);
    await expect(run('owner@towncore.net', townFile)).rejects.toThrow(/PNG, WebP or JPEG/);
  });

  it('writes the assets, sets the YAML and config, and records the art as AI-generated', async () => {
    const { config } = await run('Owner@towncore.net');
    expect(config).toEqual({
      hero_art: { src: '/brand/harbor-point/hero.webp', width: 1221, height: 407 },
      app_icon: '/brand/harbor-point',
    });
    expect(readdirSync(join(dir, 'public/brand/harbor-point')).sort()).toEqual(
      [...IDENTITY_FILES].sort(),
    );
    const yaml = parseTownConfig(readFileSync(townFile, 'utf8'));
    expect(yaml).toMatchObject({ ...config, site_name: 'The Harbor Point Ledger' });
    const [town] = await db.select().from(towns).where(eq(towns.slug, 'harbor-point'));
    expect(town!.config).toMatchObject({ slug: 'harbor-point', ...config });
    const [row] = await db.select().from(identityArt);
    expect(row).toMatchObject({
      aiGenerated: true,
      source: 'ChatGPT, made by the owner',
      fileName: 'ChatGPT Image.png',
      width: 1400,
      height: 640,
      assetDir: '/brand/harbor-point',
    });
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const log = await db.select().from(adminActions);
    expect(log.map((l) => l.action)).toEqual(['identity_art.import']);
  });
});
