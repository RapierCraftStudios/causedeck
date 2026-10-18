import { describe, expect, it } from 'vitest';

import { appName } from './index';

describe('@causedeck/worker', () => {
  it('exports its app name', () => {
    expect(appName).toBe('@causedeck/worker');
  });
});
