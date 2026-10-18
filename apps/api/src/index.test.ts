import { describe, expect, it } from 'vitest';

import { appName } from './index';

describe('@causedeck/api', () => {
  it('exports its app name', () => {
    expect(appName).toBe('@causedeck/api');
  });
});
