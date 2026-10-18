import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const sharedBases = ['base', 'nextjs', 'node', 'react-library'].map(
  (name) => `@causedeck/config/tsconfig/${name}.json`,
);

const workspaceTsconfigs = ['apps', 'packages'].flatMap((group) =>
  readdirSync(path.join(repoRoot, group))
    .map((name) => path.join(repoRoot, group, name, 'tsconfig.json'))
    .filter((file) => existsSync(file)),
);

interface LoadedConfig {
  extends: string;
  parsed: ts.ParsedCommandLine;
}

/** Load a tsconfig with the TypeScript API, resolving its `extends` chain. */
function loadConfig(file: string): LoadedConfig {
  const result = ts.readConfigFile(file, (p) => ts.sys.readFile(p));
  const config: unknown = result.config;
  if (result.error || typeof config !== 'object' || config === null) {
    throw new Error(ts.flattenDiagnosticMessageText(result.error?.messageText ?? file, '\n'));
  }
  const extended = 'extends' in config ? config.extends : undefined;
  return {
    extends: typeof extended === 'string' ? extended : '',
    parsed: ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(file), undefined, file),
  };
}

describe('workspace tsconfigs', () => {
  it('covers all 5 apps and 17 packages', () => {
    expect(workspaceTsconfigs).toHaveLength(22);
  });

  describe.each(workspaceTsconfigs.map((file) => [path.relative(repoRoot, file), file]))(
    '%s',
    (_name, file) => {
      const { extends: extended, parsed } = loadConfig(file);

      it('extends a shared base', () => {
        const isShared =
          sharedBases.includes(extended) ||
          path
            .resolve(path.dirname(file), extended)
            .startsWith(path.join(repoRoot, 'packages', 'config', 'tsconfig'));
        expect(isShared, `extends "${extended}"`).toBe(true);
      });

      it('resolves with strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes', () => {
        expect(parsed.errors.filter((d) => d.code !== 18003)).toEqual([]);
        expect(parsed.options.strict).toBe(true);
        expect(parsed.options.noUncheckedIndexedAccess).toBe(true);
        expect(parsed.options.exactOptionalPropertyTypes).toBe(true);
      });
    },
  );
});
