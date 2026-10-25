// The message protocol of the on-device captcha solver worker (#593, D-048): the page posts one
// image per request and gets text back, or a failure reason. The worker has no network path of its
// own; a failure means "use the server fallback", never a captcha shown to the lawyer.

export interface SolveRequest {
  id: number;
  image: Blob;
}

export type SolveResponse =
  | { id: number; type: 'text'; text: string }
  | { id: number; type: 'error'; reason: 'unavailable' | 'unreadable' };

/** The solver the refresh uses: the text of a captcha image, or null when it cannot read one. */
export interface CaptchaSolver {
  solve(image: Blob): Promise<string | null>;
  dispose(): void;
}

/** The characters a status-portal captcha uses; OCR noise outside them is dropped. */
export const CAPTCHA_ALPHABET = /[^0-9A-Za-z]/g;
export const MIN_CAPTCHA_LENGTH = 4;
export const MAX_CAPTCHA_LENGTH = 8;

/** The cleaned captcha text, or null when OCR output cannot be a captcha (wrong length). */
export function normalizeCaptchaText(raw: string): string | null {
  const text = raw.replace(CAPTCHA_ALPHABET, '');
  return text.length >= MIN_CAPTCHA_LENGTH && text.length <= MAX_CAPTCHA_LENGTH ? text : null;
}
