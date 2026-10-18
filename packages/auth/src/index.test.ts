import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/auth', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/auth');
  });
});
