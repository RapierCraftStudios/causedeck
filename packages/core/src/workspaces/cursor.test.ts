import { describe, expect, it } from 'vitest';

import { decodeWorkspaceCursor, encodeWorkspaceCursor, InvalidCursorError } from './index.ts';

describe('workspace cursor', () => {
  it('round-trips (createdAt, id)', () => {
    const cursor = {
      createdAt: '2026-10-01 10:00:00.123456+00',
      id: '0b9c1f7e-6f3a-4c55-9c1e-2d5b6a7c8d9e',
    };
    const encoded = encodeWorkspaceCursor(cursor);
    expect(encoded).toMatch(/^[\w-]+$/);
    expect(decodeWorkspaceCursor(encoded)).toEqual(cursor);
  });

  it.each([
    'not-base64-json',
    Buffer.from('{}').toString('base64url'),
    Buffer.from('["2026-10-01T00:00:00Z","not-a-uuid"]').toString('base64url'),
    Buffer.from('["nope","0b9c1f7e-6f3a-4c55-9c1e-2d5b6a7c8d9e"]').toString('base64url'),
  ])('rejects %s', (value) => {
    expect(() => decodeWorkspaceCursor(value)).toThrow(InvalidCursorError);
  });
});
