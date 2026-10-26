import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROLES } from '../../roles';
import { ALL_ACTIONS } from '../actions';
import { renderPermissionsDoc } from '../docs';

const DOC = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs',
  'engineering',
  'permissions.md',
);

describe('docs/engineering/permissions.md', () => {
  it('is up to date with the matrix (run `pnpm docs:permissions`)', () => {
    expect(
      readFileSync(DOC, 'utf8') === renderPermissionsDoc(),
      'docs/engineering/permissions.md is stale: run `pnpm docs:permissions` and commit it',
    ).toBe(true);
  });

  it('lists every action and role', () => {
    const doc = renderPermissionsDoc();
    for (const action of ALL_ACTIONS) expect(doc).toContain(`\`${action}\``);
    for (const role of ROLES) expect(doc).toContain(role);
  });
});
