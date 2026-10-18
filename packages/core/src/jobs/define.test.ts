import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { deadLetterQueue, DEFAULT_RETRY, defineJob, JOB_NAME_PATTERN } from './define.ts';

const handler = () => Promise.resolve();

describe('defineJob', () => {
  it('requires <domain>.<verb> names', () => {
    for (const name of ['notification.send', 'document.ocr', 'system.retention.sweep']) {
      expect(JOB_NAME_PATTERN.test(name)).toBe(true);
    }
    for (const name of ['ping', 'Notification.Send', 'notification.', 'notification send']) {
      expect(() =>
        defineJob({ name, schema: z.object({ workspaceId: z.uuid() }), handler }),
      ).toThrow(/<domain>\.<verb>/);
    }
  });

  it('requires a zod object schema', () => {
    expect(() =>
      // @ts-expect-error: a schema is required.
      defineJob({ name: 'document.ocr', handler }),
    ).toThrow(/zod object schema/);
    expect(() =>
      defineJob({ name: 'document.ocr', schema: { workspaceId: 'x' } as never, handler }),
    ).toThrow(/zod object schema/);
  });

  it('requires workspaceId in payloads except for system.* jobs', () => {
    expect(() =>
      defineJob({ name: 'document.ocr', schema: z.object({ documentId: z.uuid() }), handler }),
    ).toThrow(/must require workspaceId/);
    expect(() =>
      defineJob({
        name: 'document.ocr',
        schema: z.object({ workspaceId: z.uuid().optional() }),
        handler,
      }),
    ).toThrow(/must require workspaceId/);
    expect(() => defineJob({ name: 'system.tick', schema: z.object({}), handler })).not.toThrow();
  });

  it('defaults to 5 attempts with exponential backoff', () => {
    const def = defineJob({
      name: 'document.ocr',
      schema: z.object({ workspaceId: z.uuid() }),
      handler,
    });
    expect(DEFAULT_RETRY).toMatchObject({ limit: 4, backoff: true });
    expect(def.retry).toEqual(DEFAULT_RETRY);
    expect(def.fairnessConcurrency).toBe(3);
    expect(deadLetterQueue(def.name)).toBe('document.ocr__dlq');
  });

  it('merges a partial retry policy and validates concurrency', () => {
    const def = defineJob({
      name: 'document.ocr',
      schema: z.object({ workspaceId: z.uuid() }),
      retry: { limit: 1 },
      concurrency: 3,
      handler,
    });
    expect(def.retry).toEqual({ ...DEFAULT_RETRY, limit: 1 });
    expect(def.concurrency).toBe(3);
    expect(() =>
      defineJob({
        name: 'document.ocr',
        schema: z.object({ workspaceId: z.uuid() }),
        concurrency: 0,
        handler,
      }),
    ).toThrow(/concurrency/);
  });
});
