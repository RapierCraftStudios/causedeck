import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/observability', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/observability');
  });
});
