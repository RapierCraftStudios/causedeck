// The structural no-L5 guard (#47, #104) passes on the repository: no fifth automation level, no
// send/file/pay proposal kind, no outward import in the automation domain. The Semgrep rule
// `causedeck.l5-automation-action` (infra/security/semgrep/rules.yml) is the editor-time companion;
// this is the same check the security workflow runs as `pnpm check:no-l5`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkNoL5 } from '../../../scripts/check-no-l5.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('no L5 action type exists', () => {
  it('reports no violation in the repository', () => {
    expect(checkNoL5(ROOT)).toEqual([]);
  });
});
