import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/notifications', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/notifications');
  });
});
