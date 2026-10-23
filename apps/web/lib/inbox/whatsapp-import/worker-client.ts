// Main-thread side of the parse worker (#527): one worker per parse, terminated when it answers.
import type { DateOrder } from '@causedeck/capture/whatsapp';

import type { ParsedChat, ParseFailure, WorkerResponse } from './types.ts';

export type ParseOutcome = { ok: true; chat: ParsedChat } | { ok: false; reason: ParseFailure };

export function parseInWorker(
  file: File,
  options: { dateOrder?: DateOrder; onProgress?: (fraction: number) => void } = {},
): Promise<ParseOutcome> {
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL('../../../workers/whatsapp-parse.worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );
    const finish = (outcome: ParseOutcome) => {
      worker.terminate();
      resolve(outcome);
    };
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') options.onProgress?.(message.fraction);
      else if (message.type === 'done') finish({ ok: true, chat: message.chat });
      else finish({ ok: false, reason: message.reason });
    });
    worker.addEventListener('error', () => {
      finish({ ok: false, reason: 'failed' });
    });
    worker.postMessage({
      type: 'parse',
      file,
      ...(options.dateOrder === undefined ? {} : { dateOrder: options.dateOrder }),
    });
  });
}
