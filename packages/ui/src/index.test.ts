import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/ui', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/ui');
  });
});
