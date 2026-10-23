// Static guards over the provider adapters (#44): none may pass tool, function-calling, web or
// retrieval parameters to a model, and none may read credentials from the environment.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../providers');
const files = readdirSync(dir).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'types.ts',
);

const FORBIDDEN =
  /\b(tools?|tool_config|toolConfig|tool_choice|toolChoice|function_call|functionCall|functions|web_search|retrieval|guardrailConfig|additionalModelRequestFields)\b/;

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('provider adapters', () => {
  it('finds the adapters', () => {
    expect(files).toEqual(expect.arrayContaining(['bedrock.ts', 'mock.ts', 'sarvam.ts']));
  });

  it.each(files)('%s passes no tool, function, web or retrieval parameters', (file) => {
    const code = stripComments(readFileSync(path.join(dir, file), 'utf8'));
    expect(FORBIDDEN.exec(code)?.[0]).toBeUndefined();
  });

  it.each(files)('%s never reads process.env', (file) => {
    expect(readFileSync(path.join(dir, file), 'utf8')).not.toMatch(/process\.env/);
  });
});
