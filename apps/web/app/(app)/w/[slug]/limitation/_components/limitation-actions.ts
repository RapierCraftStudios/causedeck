import type { Result } from '../../../../../../lib/safe-action.ts';

type Saved = Result<{ id: string; expiresOn: string }>;

/** The limitation server actions the client components call (injected by the page). */
export interface LimitationActions {
  compute: (input: unknown) => Promise<Saved>;
  confirm: (input: unknown) => Promise<Saved>;
}

export type LimitationErrorKey = 'forbidden' | 'invalid' | 'conflict' | 'failed';

/** The translation key for a failed action; the server's message never reaches the screen. */
export function limitationErrorKey(code: string): LimitationErrorKey {
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return 'forbidden';
  if (code === 'VALIDATION') return 'invalid';
  if (code === 'CONFLICT') return 'conflict';
  return 'failed';
}
