import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/validators', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/validators');
  });
});
it('CI-PROBE deliberate failure', () => { expect(1).toBe(2); });
