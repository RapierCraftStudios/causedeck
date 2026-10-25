// What a proposal kind shows on its card and what the person may correct (#48). One descriptor per
// `ProposalKind`: the value as a short text (for the accessible name and the toast), the value as
// the card shows it, and the payload fields the inline editor offers. Payload keys are the
// handler's (`packages/core/src/automation/handlers/*`); a corrected payload goes through
// `editAndAccept`, which validates it again.
import type { Locale } from '@causedeck/i18n';
import type { ReactNode } from 'react';

export type Payload = Record<string, unknown>;

export interface FieldSpec {
  key: string;
  /** `inbox.card.field.<label>`. */
  label: 'date' | 'title' | 'description' | 'dueDate' | 'name' | 'number' | 'year';
  type: 'date' | 'text' | 'number';
}

export interface KindContext {
  locale: Locale;
}

export interface KindDescriptor {
  fields: readonly FieldSpec[];
  /** The value as plain text; empty when the payload has nothing to show. */
  text(payload: Payload, ctx: KindContext): string;
  /** The value as the card's diff shows it. */
  render(payload: Payload, ctx: KindContext): ReactNode;
}

export const str = (payload: Payload, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

export const num = (payload: Payload, key: string): number | null => {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
};
