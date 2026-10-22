// The channel and status lists exist in `@causedeck/db` (the table) and `@causedeck/validators`
// (request schemas); this keeps them, the machine and the job reasons in step (#43).
import { schema } from '@causedeck/db';
import { CAPTURE_CHANNELS, CAPTURE_STATUSES } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

import {
  CAPTURE_FAILURE_REASONS,
  CAPTURE_JOB_NAMES,
  CAPTURE_TRANSITIONS,
  DEFAULT_ENABLED_CHANNELS,
} from '../index.ts';

describe('capture lists', () => {
  it('the table and the request schemas name the same channels and statuses', () => {
    expect([...schema.CAPTURE_CHANNELS]).toEqual([...CAPTURE_CHANNELS]);
    expect([...schema.CAPTURE_STATUSES]).toEqual([...CAPTURE_STATUSES]);
    expect(Object.keys(CAPTURE_TRANSITIONS)).toEqual([...CAPTURE_STATUSES]);
  });

  it('only manual and upload start enabled', () => {
    expect([...DEFAULT_ENABLED_CHANNELS].sort()).toEqual(['manual', 'upload']);
    for (const channel of DEFAULT_ENABLED_CHANNELS) expect(CAPTURE_CHANNELS).toContain(channel);
  });

  it('has no channel for SMS, notifications or contacts (CA-12)', () => {
    expect(CAPTURE_CHANNELS.join(' ')).not.toMatch(/sms|notification|contact/);
  });

  it('names the jobs and user-safe failure reasons', () => {
    expect(CAPTURE_JOB_NAMES).toMatchObject({
      scan: 'capture.scan',
      process: 'capture.process',
      retention: 'capture.retention',
    });
    expect(CAPTURE_FAILURE_REASONS).toContain('too_large');
  });
});
