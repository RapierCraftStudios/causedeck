// WhatsApp export parsing off the main thread (#527, ADR 0026): unzip with fflate, parse with the
// isomorphic `@causedeck/capture/whatsapp` entry (never the package root: it pulls server code) and
// flag the exclusion rules. The worker has no network access path: it only posts results back.
import { ParseChatError, parseChat } from '../lib/inbox/whatsapp-import/parse-chat.ts';
import type { WorkerRequest, WorkerResponse } from '../lib/inbox/whatsapp-import/types.ts';

const scope = self as unknown as {
  postMessage: (message: WorkerResponse) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void;
};

scope.addEventListener('message', (event) => {
  const request = event.data;
  void (async () => {
    try {
      scope.postMessage({ type: 'progress', stage: 'read', fraction: 0.1 });
      const bytes = new Uint8Array(await request.file.arrayBuffer());
      scope.postMessage({ type: 'progress', stage: 'unzip', fraction: 0.4 });
      const chat = await parseChat(bytes, request.file.name, {
        ...(request.dateOrder === undefined ? {} : { dateOrder: request.dateOrder }),
      });
      scope.postMessage({ type: 'progress', stage: 'parse', fraction: 1 });
      scope.postMessage({ type: 'done', chat });
    } catch (error) {
      scope.postMessage({
        type: 'error',
        reason: error instanceof ParseChatError ? error.reason : 'failed',
      });
    }
  })();
});
