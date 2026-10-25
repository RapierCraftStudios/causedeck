import { describe, expect, it } from 'vitest';

import {
  CaptureCompleteRequestSchema,
  CapturePresignRequestSchema,
  CaptureStatusSchema,
} from './index';

const WORKSPACE = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const SHA = 'a'.repeat(64);

describe('capture schemas', () => {
  const presign = {
    workspaceId: WORKSPACE,
    channel: 'upload',
    filename: 'order.pdf',
    mime: 'application/pdf',
    sizeBytes: 1234,
    sha256: SHA,
  };

  it('accepts a presign request, with or without a matter hint', () => {
    expect(CapturePresignRequestSchema.safeParse(presign).success).toBe(true);
    expect(
      CapturePresignRequestSchema.safeParse({ ...presign, matterHintId: WORKSPACE }).success,
    ).toBe(true);
  });

  it.each([
    ['an unknown channel', { channel: 'sms' }],
    ['a channel with no upload flow', { channel: 'email' }],
    ['an empty file', { sizeBytes: 0 }],
    ['a fractional size', { sizeBytes: 1.5 }],
    ['an upper-case hash', { sha256: 'A'.repeat(64) }],
    ['a short hash', { sha256: 'abc' }],
    ['an empty filename', { filename: '' }],
    ['a non-uuid workspace', { workspaceId: 'x' }],
  ])('rejects %s', (_label, patch) => {
    expect(CapturePresignRequestSchema.safeParse({ ...presign, ...patch }).success).toBe(false);
  });

  it('checks the complete request and the statuses', () => {
    expect(
      CaptureCompleteRequestSchema.safeParse({ workspaceId: WORKSPACE, sha256: SHA }).success,
    ).toBe(true);
    expect(CaptureCompleteRequestSchema.safeParse({ workspaceId: WORKSPACE }).success).toBe(false);
    expect(CaptureStatusSchema.safeParse('quarantined').success).toBe(true);
    expect(CaptureStatusSchema.safeParse('done').success).toBe(false);
  });
});
