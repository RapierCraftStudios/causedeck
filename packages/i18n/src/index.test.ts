import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('@causedeck/i18n', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/i18n');
  });
});
