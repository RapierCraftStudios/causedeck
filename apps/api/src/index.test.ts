import { describe, expect, it } from 'vitest';

import { appName, createApp, defineRoute } from './index';

describe('@causedeck/api', () => {
  it('exports its app name and the app factory', () => {
    expect(appName).toBe('@causedeck/api');
    expect(createApp).toBeTypeOf('function');
    expect(defineRoute).toBeTypeOf('function');
  });
});
