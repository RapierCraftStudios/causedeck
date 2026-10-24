// The shapes the email intake settings components share with the page's server actions (#54).
import type { Result } from '../../../lib/safe-action.ts';

export interface IntakeAddress {
  id: string;
  address: string;
  createdAt: Date;
}

export interface AllowlistEntry {
  id: string;
  pattern: string;
  kind: string;
  label: string | null;
  isDomain: boolean;
  createdAt: Date;
}

export type ActionFn<T> = (input: unknown) => Promise<Result<T>>;

/** The allow-list kinds, in display order (mirrors `INTAKE_ALLOWLIST_KINDS` in `@causedeck/db`). */
export const ALLOWLIST_KINDS = ['court', 'efiling', 'self', 'briefing_counsel'] as const;
