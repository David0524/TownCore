import { defineConfig } from 'tsup';

// Workspace packages ship as TypeScript source, so bundle them (and their dependencies) into
// the worker build. Some of those dependencies are CommonJS and call require(), which an ESM
// bundle doesn't provide, hence the createRequire banner.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: [/^@towncore\//],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
