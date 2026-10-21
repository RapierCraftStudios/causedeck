import { describe, expect, it } from 'vitest';

import { assertWithinLimit, MAX_OBJECT_BYTES, ObjectTooLargeError } from '../limits.ts';

const MB = 1024 * 1024;

describe('size limits', () => {
  it('caps documents at 50 MB, audio 100 MB, images 25 MB and zips 200 MB, exports 20 GB', () => {
    expect(MAX_OBJECT_BYTES).toEqual({
      document: 50 * MB,
      audio: 100 * MB,
      image: 25 * MB,
      zip: 200 * MB,
      export: 20 * 1024 * MB,
    });
  });

  it('accepts the cap and rejects one byte over', () => {
    expect(() => {
      assertWithinLimit('image', 25 * MB);
    }).not.toThrow();
    expect(() => {
      assertWithinLimit('image', 25 * MB + 1);
    }).toThrow(ObjectTooLargeError);
  });

  it('rejects negative and fractional sizes', () => {
    expect(() => {
      assertWithinLimit('document', -1);
    }).toThrow(RangeError);
    expect(() => {
      assertWithinLimit('document', 1.5);
    }).toThrow(RangeError);
  });
});
