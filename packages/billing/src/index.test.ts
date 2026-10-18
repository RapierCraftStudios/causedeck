import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/billing', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/billing');
  });
});
