// The static guard (#47, PRD TR-1): `scripts/check-no-l5.ts` run against fixture trees, and against
// this repository. The guard runs as a separate process, as CI runs it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildHandlerRegistry, HandlerRegistrationError } from './handlers/index.ts';
import { AUTOMATION_LEVELS } from './levels.ts';
import type { ProposalHandler } from './types.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = path.join(REPO, 'scripts', 'check-no-l5.ts');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fixture tree with the given files (path relative to its root). */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'no-l5-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

function run(root: string): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', SCRIPT, '--root', root],
    { encoding: 'utf8' },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const KINDS = (kinds: string[]) =>
  `export const PROPOSAL_KINDS = [${kinds.map((k) => `'${k}'`).join(', ')}] as const;\n`;
const VALIDATORS = 'packages/validators/src/proposal-draft.ts';
const HANDLER = (name: string) => `packages/core/src/automation/handlers/${name}.ts`;

describe('scripts/check-no-l5.ts', () => {
  it('passes on this repository', () => {
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', SCRIPT],
      { encoding: 'utf8' },
    );
    expect(output).toMatch(/no fifth level or send path/);
  });

  it('passes a clean tree', () => {
    const root = tree({
      [VALIDATORS]: KINDS(['task', 'next_date']),
      [HANDLER('task')]: "export const h = { kind: 'task' };\n",
      'packages/core/src/levels.ts': "export type Level = 'L1' | 'L2' | 'L3' | 'L4';\n",
    });
    expect(run(root).status).toBe(0);
  });

  it('fails on a fifth level in code, but not in a comment, a test or a fixture', () => {
    const bad = tree({ 'packages/a/src/x.ts': "export const level = 'L5';\n" });
    const result = run(bad);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/x\.ts:1 \[fifth-level\]/);
    const fine = tree({
      'packages/a/src/x.ts': "// there is no L5\n/* L5 */ export const level = 'L4';\n",
      'packages/a/src/x.test.ts': "export const level = 'L5';\n",
      'packages/a/src/__tests__/y.ts': "export const level = 'L5';\n",
      'apps/b/src/z.stories.tsx': "export const level = 'L6';\n",
    });
    expect(run(fine).status).toBe(0);
    const app = tree({ 'apps/b/src/z.ts': 'export const level = `L6`;\n' });
    expect(run(app).status).toBe(1);
  });

  it.each([
    'send_email',
    'file_petition',
    'e_file',
    'pay_fee',
    'advise_client',
    'accept_engagement',
    'insert_citation',
    'generate_citation',
    'auto_reply',
  ])('fails when the registry holds the kind %s', (kind) => {
    const root = tree({ [VALIDATORS]: KINDS(['task', kind]) });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/forbidden-kind/);
  });

  it('does not mistake a longer word for a forbidden kind', () => {
    const root = tree({ [VALIDATORS]: KINDS(['task', 'profile_update', 'listing_update']) });
    expect(run(root).status).toBe(0);
  });

  it('fails when a handler is registered for an unknown or forbidden kind', () => {
    const unknown = tree({
      [VALIDATORS]: KINDS(['task']),
      [HANDLER('mystery')]: "export const h = { kind: 'mystery' };\n",
    });
    expect(run(unknown).output).toMatch(/unknown-handler-kind/);
    const forbidden = tree({
      [VALIDATORS]: KINDS(['task']),
      [HANDLER('send')]: "export const h = { kind: 'send_message' };\n",
    });
    expect(run(forbidden).output).toMatch(/forbidden-kind/);
    const disabled = tree({
      [VALIDATORS]: KINDS(['task']),
      [HANDLER('off')]: "export const h = disabledHandler('fee_entry', 'later');\n",
    });
    expect(run(disabled).output).toMatch(/unknown-handler-kind/);
  });

  it.each([
    "import { notify } from '../../notifications/index.ts';",
    "import { send } from '@causedeck/notifications';",
    "import nodemailer from 'nodemailer';",
    "import twilio from 'twilio';",
  ])('fails when an automation module imports an outward transport: %s', (line) => {
    const root = tree({
      [VALIDATORS]: KINDS(['task']),
      [HANDLER('task')]: `${line}\nexport const h = { kind: 'task' };\n`,
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/outward-import/);
  });
});

describe('the handler registry', () => {
  const stub = (kind: string): ProposalHandler<never> =>
    ({
      kind,
      enabled: true,
      validate: () => undefined,
      apply: () => undefined,
      undo: () => undefined,
    }) as unknown as ProposalHandler<never>;

  it('refuses an unknown kind, a forbidden kind and a duplicate', () => {
    expect(() => buildHandlerRegistry([stub('mystery')])).toThrow(HandlerRegistrationError);
    expect(() => buildHandlerRegistry([stub('send_message')])).toThrow(/never performs/);
    expect(() => buildHandlerRegistry([stub('task'), stub('task')])).toThrow(/twice/);
  });

  it('requires a handler for every kind', () => {
    expect(() => buildHandlerRegistry([stub('task')])).toThrow(/no handler for/);
  });
});

describe('the ladder', () => {
  it('is exactly L1 to L4', () => {
    expect([...AUTOMATION_LEVELS]).toEqual(['L1', 'L2', 'L3', 'L4']);
  });
});
