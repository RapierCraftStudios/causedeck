import path from 'node:path';

import { ESLint } from 'eslint';

import { base } from '../eslint/base.js';

export const fixturesDir = path.join(import.meta.dirname, '..', 'eslint', '__fixtures__');

/** Lint one fixture file with the shared base config, using its fixture root as cwd. */
export async function lintFixture(root: string, file: string): Promise<ESLint.LintResult> {
  const cwd = path.join(fixturesDir, root);
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [...base, { languageOptions: { parserOptions: { tsconfigRootDir: cwd } } }],
  });
  const [result] = await eslint.lintFiles([path.join(cwd, file)]);
  if (!result) throw new Error(`ESLint returned no result for ${file}`);
  return result;
}

export function ruleIds(result: ESLint.LintResult): (string | null)[] {
  return result.messages.map((message) => message.ruleId);
}
