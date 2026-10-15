import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CLAUDE.md §11a: no component may hardcode a color, font or radius. Everything goes through
// theme tokens (--ink, --font-headline, --radius, ...) or locked network tokens (--net-*).
const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(css|tsx?)$/.test(entry.name) ? [path] : [];
  });
}

const rules: Array<{ name: string; pattern: RegExp }> = [
  { name: 'hex color', pattern: /#[0-9a-fA-F]{3,8}\b(?![-\w])/ },
  { name: 'rgb/hsl color', pattern: /\b(rgba?|hsla?)\(/ },
  {
    name: 'named color',
    pattern:
      /(?:color|background(?:-color)?|border(?:-\w+)?)\s*:\s*(white|black|red|blue|green|gray|grey)\b/,
  },
  { name: 'literal font-family', pattern: /font-family\s*:\s*(?!\s|var\()/ },
  { name: 'literal border-radius', pattern: /border-radius\s*:\s*(?!\s|var\()/ },
];

// Token sources: these files turn config into custom properties, so they may hold values.
const allowed = new Set(['lib/theme.ts', 'lib/brand.ts']);

describe('no hardcoded design tokens in apps/web/src', () => {
  const sources = files(srcDir).filter((file) => !allowed.has(relative(srcDir, file)));

  it('finds source files to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const rule of rules) {
    it(`no ${rule.name}`, () => {
      const hits = sources.flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
          .filter(({ line }) => rule.pattern.test(line))
          .map(({ line, i }) => `${relative(srcDir, file)}:${i + 1}: ${line.trim()}`),
      );
      expect(hits).toEqual([]);
    });
  }
});
