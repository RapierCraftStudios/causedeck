import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/intelligence', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/intelligence');
  });
});
