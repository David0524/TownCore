import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { illustrationShots } from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { importIllustrations, librarySource, shotListMarkdown } from '../src/illustrations';

// Importing the owner's section illustrations (CLAUDE.md §11c): only files named by a shot ID
// and with alt text written for them; re-encoded to 1200×800 WebP; recorded with the approver.

/** A solid-color PNG, written by hand so the test needs no image library. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('section illustrations', () => {
  it('lists every shot once in the shot list, with the style', () => {
    const md = shotListMarkdown();
    for (const s of illustrationShots) expect(md).toContain(`**${s.id}**`);
    expect(new Set(illustrationShots.map((s) => s.id)).size).toBe(illustrationShots.length);
    expect(md).toContain('No text, letters, numbers, logos');
  });

  it('imports named, described images and skips the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ill-in-'));
    const webDir = await mkdtemp(join(tmpdir(), 'ill-out-'));
    await writeFile(join(dir, 'gov-03.png'), png(1536, 1024));
    await writeFile(join(dir, 'gov-05.png'), png(1536, 1024));
    await writeFile(join(dir, 'IMG_2231.png'), png(1536, 1024));
    await writeFile(join(dir, 'gov-06.png'), png(400, 300));
    const { result, library } = await importIllustrations({
      dir,
      alts: { 'gov-03': 'A gavel on its block.', 'gov-06': 'A bar chart.' },
      approvedBy: 'Owner@TownCore.net',
      library: [],
      webDir,
      now: new Date('2026-10-16T12:00:00Z'),
    });
    expect(result.imported).toEqual(['gov-03']);
    expect(result.skipped).toEqual([
      { file: 'IMG_2231.png', why: 'not a shot ID' },
      { file: 'gov-05.png', why: 'no alt text' },
      { file: 'gov-06.png', why: 'too small (400 px wide; need 800)' },
    ]);
    expect(library).toEqual([
      {
        id: 'gov-03',
        width: 1200,
        height: 800,
        alt: 'A gavel on its block.',
        approvedBy: 'owner@towncore.net',
        importedAt: '2026-10-16',
      },
    ]);
    const webp = await readFile(join(webDir, 'gov-03.webp'));
    expect(webp.subarray(8, 12).toString()).toBe('WEBP');
    expect(librarySource(library)).toContain('"id": "gov-03"');
  });

  it('needs the approver', async () => {
    await expect(
      importIllustrations({ dir: '.', alts: {}, approvedBy: 'me', library: [], webDir: '.' }),
    ).rejects.toThrow('--approved-by');
  });
});
