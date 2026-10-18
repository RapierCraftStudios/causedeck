import { Writable } from 'node:stream';

import { createLogger, type CreateLoggerOptions, type Logger } from '../logger.ts';

export interface Captured {
  logger: Logger;
  /** Raw output, one JSON object per line. */
  raw: () => string;
  lines: () => Record<string, unknown>[];
}

/** A logger writing synchronously to memory. */
export function captureLogger(options: Partial<CreateLoggerOptions> = {}): Captured {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({
    service: 'test',
    level: 'trace',
    runtime: { env: 'test', version: 'abc123', region: 'ap-south-1' },
    destination,
    ...options,
  });
  const raw = () => chunks.join('');
  return {
    logger,
    raw,
    lines: () =>
      raw()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
