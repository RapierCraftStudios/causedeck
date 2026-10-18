import { describe, expect, it } from 'vitest';

import { appName } from './index';

describe('@causedeck/admin', () => {
  it('exports its app name', () => {
    expect(appName).toBe('@causedeck/admin');
  });
});
