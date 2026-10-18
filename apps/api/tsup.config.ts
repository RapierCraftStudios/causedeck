import { defineConfig } from 'tsup';

// `pnpm build`: one ESM bundle of the server with the workspace packages inlined (they ship as
// TypeScript source). The Docker image runs the source through tsx, like the worker.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@causedeck\//],
});
