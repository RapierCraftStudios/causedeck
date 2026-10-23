// On-device captcha solving off the main thread (#593, D-048 tier 4): a small OCR model
// (tesseract.js, loaded lazily on the first image) reads a status-portal captcha image and posts the
// text back. The image never leaves the device here; the worker only posts results to the page and
// a failure makes the caller fall back to the server path.
import {
  normalizeCaptchaText,
  type SolveRequest,
  type SolveResponse,
} from '../lib/case-watch/solver.types.ts';

interface Engine {
  recognize(image: Blob): Promise<{ data: { text: string } }>;
}

const scope = self as unknown as {
  postMessage: (message: SolveResponse) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent<SolveRequest>) => void) => void;
};

let engine: Promise<Engine> | undefined;

function loadEngine(): Promise<Engine> {
  engine ??= import('tesseract.js').then(async ({ createWorker, PSM }) => {
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    });
    return worker;
  });
  return engine;
}

scope.addEventListener('message', (event) => {
  const { id, image } = event.data;
  void (async () => {
    let ocr: Engine;
    try {
      ocr = await loadEngine();
    } catch {
      engine = undefined;
      scope.postMessage({ id, type: 'error', reason: 'unavailable' });
      return;
    }
    try {
      const { data } = await ocr.recognize(image);
      const text = normalizeCaptchaText(data.text);
      scope.postMessage(
        text === null ? { id, type: 'error', reason: 'unreadable' } : { id, type: 'text', text },
      );
    } catch {
      scope.postMessage({ id, type: 'error', reason: 'unreadable' });
    }
  })();
});
