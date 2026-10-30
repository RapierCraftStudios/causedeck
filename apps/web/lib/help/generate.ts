// Node-only: renders content/help/sources.generated.ts from content/help/*.mdx so the articles ship
// in the bundle (no runtime file reads, which `output: standalone` would not trace). Regenerate with
// `node --experimental-strip-types -e "import('./lib/help/generate.ts').then((m) => m.writeSources())"` from apps/web.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CONTENT = path.join(import.meta.dirname, '..', '..', 'content', 'help');

export function renderSources(): string {
  const files = readdirSync(CONTENT)
    .filter((file) => file.endsWith('.mdx'))
    .sort();
  const rows = files.map(
    (file) =>
      `  ${JSON.stringify(file.replace(/\.mdx$/, ''))}: ${JSON.stringify(readFileSync(path.join(CONTENT, file), 'utf8'))},`,
  );
  return `// Generated from content/help/*.mdx by lib/help/generate.ts. Do not edit.\nexport const HELP_SOURCES: Readonly<Record<string, string>> = {\n${rows.join('\n')}\n};\n`;
}

export function writeSources(): void {
  writeFileSync(path.join(CONTENT, 'sources.generated.ts'), renderSources());
}
