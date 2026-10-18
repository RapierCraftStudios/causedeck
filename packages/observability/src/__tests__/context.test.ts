import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';

import { getRequestContext, requestIdFrom, withRequestContext } from '../context.ts';
import { initTelemetry, withSpan, type Telemetry } from '../otel.ts';
import { captureLogger } from './helpers.ts';

let telemetry: Telemetry | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
});

describe('request context', () => {
  it('propagates requestId across await boundaries and timers', async () => {
    const seen = await withRequestContext({ requestId: 'r-42' }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const nested = await Promise.all(
        [1, 2].map(() => Promise.resolve(getRequestContext()?.requestId)),
      );
      return [getRequestContext()?.requestId, ...nested];
    });

    expect(seen).toEqual(['r-42', 'r-42', 'r-42']);
    expect(getRequestContext()).toBeUndefined();
  });

  it('isolates concurrent requests', async () => {
    const run = (id: string, delay: number) =>
      withRequestContext({ requestId: id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getRequestContext()?.requestId;
      });

    expect(await Promise.all([run('a', 10), run('b', 1)])).toEqual(['a', 'b']);
  });

  it('flows into child loggers', async () => {
    const { logger, lines } = captureLogger();
    const child = logger.child({ jobId: 'j1' });

    await withRequestContext({ requestId: 'r-child' }, async () => {
      await Promise.resolve();
      child.info('from child');
    });

    expect(lines()[0]).toMatchObject({ requestId: 'r-child', jobId: 'j1' });
  });

  it('flows into spans', async () => {
    const exporter = new InMemorySpanExporter();
    telemetry = initTelemetry({ service: 'test', spanExporter: exporter });

    await withRequestContext({ requestId: 'r-span' }, async () => {
      await Promise.resolve();
      await withSpan('work', () => Promise.resolve());
    });

    expect(exporter.getFinishedSpans()[0]?.attributes['request.id']).toBe('r-span');
  });

  it('reuses a well-formed x-request-id and replaces a malformed one', () => {
    expect(requestIdFrom(new Headers({ 'x-request-id': 'abc-123' }))).toBe('abc-123');
    const minted = requestIdFrom(new Headers({ 'x-request-id': 'bad id <script>' }));
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(new Headers())).toMatch(/^[0-9a-f-]{36}$/);
  });
});
