import { describe, expect, it } from 'vitest';

import { withRequestContext } from '../context.ts';
import { captureLogger } from './helpers.ts';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('createLogger', () => {
  it('emits one JSON object per line with the base fields', () => {
    const { logger, raw, lines } = captureLogger({ service: 'web' });

    logger.info('one');
    logger.warn({ n: 2 }, 'two');

    expect(raw().trimEnd().split('\n')).toHaveLength(2);
    const [first] = lines();
    expect(first).toMatchObject({
      level: 'info',
      service: 'web',
      env: 'test',
      version: 'abc123',
      region: 'ap-south-1',
      msg: 'one',
    });
    expect(first?.time).toMatch(ISO_UTC);
    expect(first).not.toHaveProperty('ist');
    expect(first).not.toHaveProperty('requestId');
  });

  it('adds requestId and other context ids inside a request context', () => {
    const { logger, lines } = captureLogger();

    withRequestContext({ requestId: 'req-1', workspaceId: 'ws-1', userId: 'u-1' }, () => {
      logger.info('inside');
    });

    expect(lines()[0]).toMatchObject({ requestId: 'req-1', workspaceId: 'ws-1', userId: 'u-1' });
  });

  it('redacts child logger bindings', () => {
    const { logger, raw } = captureLogger();

    logger.child({ jobId: 'job-1', token: 'tok-raw' }).info('child');

    expect(raw()).toContain('job-1');
    expect(raw()).not.toContain('tok-raw');
  });

  it('scrubs secrets from message strings', () => {
    const { logger, raw } = captureLogger();

    logger.info('calling with api_key=abcd1234 now');

    expect(raw()).not.toContain('abcd1234');
  });

  describe('error serialisation', () => {
    const makeError = () =>
      new Error('outer failed password=hunter2', {
        cause: new TypeError('inner failed Bearer s3cr3t', { cause: 'root cause' }),
      });

    it('keeps name, scrubbed message, stack and cause chain outside production', () => {
      const { logger, lines, raw } = captureLogger();

      logger.error({ err: makeError() }, 'boom');

      const err = lines()[0]?.err as Record<string, unknown>;
      expect(err).toMatchObject({ name: 'Error' });
      expect(err.message).toContain('outer failed');
      expect(err.stack).toEqual(expect.stringContaining('outer failed'));
      expect(err.cause).toMatchObject({ name: 'TypeError', cause: 'root cause' });
      expect(raw()).not.toContain('hunter2');
      expect(raw()).not.toContain('s3cr3t');
    });

    it('omits stacks in production', () => {
      const { logger, lines } = captureLogger({
        runtime: { env: 'production', version: 'v', region: 'ap-south-1' },
      });

      logger.error(makeError());

      const err = lines()[0]?.err as Record<string, unknown>;
      expect(err.name).toBe('Error');
      expect(err).not.toHaveProperty('stack');
      expect((err.cause as Record<string, unknown>).name).toBe('TypeError');
      expect(err.cause).not.toHaveProperty('stack');
    });
  });
});
