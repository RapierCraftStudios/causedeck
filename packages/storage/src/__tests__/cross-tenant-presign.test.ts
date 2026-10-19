// Cross-tenant storage presign (#19, #209): a placeholder until presigned URLs land (#21).
// CROSS_TENANT_PRESIGN_PLACEHOLDER: the core registry test fails while this marker is here and
// `@causedeck/storage` exports presign, so #21 must replace this file with the real test.
import { describe, expect, it } from 'vitest';

import * as storage from '../index';

describe('cross-tenant storage presign', () => {
  it('has no presign export yet (#21); this placeholder must become the real test then', () => {
    expect(Object.keys(storage).filter((name) => /presign/i.test(name))).toEqual([]);
  });

  it.todo('user B cannot presign a GET or PUT for an object key of workspace A');
});
