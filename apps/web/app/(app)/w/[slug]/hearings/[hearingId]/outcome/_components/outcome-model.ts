/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
// The pure side of the outcome form (#62): typed dates, what blocks Confirm, and the confirmation
// the form submits. No React, so the rules are tested without rendering.
import type { Resolution } from '@causedeck/ui/patterns';
import type { OutcomeConfirmation, OutcomeProposal } from '@causedeck/validators/hearing-outcome';

/** A decision on one proposed obligation or task; absent means undecided (nothing is created). */
export interface RowDecision {
  action: 'confirm' | 'edit' | 'dismiss';
  text?: string | undefined;
  dueDate?: string | null | undefined;
  ownerMemberId?: string | null | undefined;
  reason?: string | undefined;
}

export type Decisions = Record<string, RowDecision | undefined>;

export interface OutcomeDraft {
  summary: string;
  adjournmentReason: string;
  stageAfter: string;
  resolution: Resolution;
  conflictChoice?: 'current' | 'proposed' | undefined;
  obligations: Decisions;
  tasks: Decisions;
}

/** `dd/mm/yyyy` to ISO, or null when it is not a real calendar date. */
export function parseTypedDate(typed: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(typed.trim());
  if (match === null) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO to `dd/mm/yyyy`. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

export type Blocker = 'summary' | 'nextDate' | 'conflict' | 'obligation';

/** Why Confirm is disabled, or null when every decision is made. */
export function blocker(proposal: OutcomeProposal, draft: OutcomeDraft): Blocker | null {
  if (draft.summary.trim() === '') return 'summary';
  if (draft.resolution.kind === 'unresolved') return 'nextDate';
  const proposed =
    draft.resolution.kind === 'value' &&
    draft.resolution.source === 'proposal' &&
    proposal.conflict !== null &&
    draft.resolution.value === proposal.conflict.proposedDate;
  if (proposed && draft.conflictChoice === undefined) return 'conflict';
  const undecided = (rows: readonly { proposalId: string }[], decided: Decisions) =>
    rows.some((row) => {
      const decision = decided[row.proposalId];
      return decision === undefined || (decision.action === 'dismiss' && !decision.reason?.trim());
    });
  if (undecided(proposal.obligations, draft.obligations)) return 'obligation';
  if (undecided(proposal.tasks, draft.tasks)) return 'obligation';
  return null;
}

/** The confirmation the action takes; the caller checked `blocker` first. */
export function toConfirmation(
  proposal: OutcomeProposal,
  draft: OutcomeDraft,
): OutcomeConfirmation {
  const resolution = draft.resolution;
  const nextDate: OutcomeConfirmation['nextDate'] =
    resolution.kind === 'value'
      ? { kind: 'date', date: resolution.value, source: resolution.source }
      : resolution.kind === 'none'
        ? { kind: 'none' }
        : { kind: 'to_be_notified' };
  return {
    hearingId: proposal.hearingId,
    outcome: draft.summary.trim(),
    ...(draft.adjournmentReason.trim() === ''
      ? {}
      : { adjournmentReason: draft.adjournmentReason.trim() }),
    ...(draft.stageAfter.trim() === '' ? {} : { stageAfter: draft.stageAfter.trim() }),
    nextDate,
    ...(draft.conflictChoice === undefined ? {} : { conflictChoice: draft.conflictChoice }),
    obligations: proposal.obligations.flatMap((row) => {
      const d = draft.obligations[row.proposalId];
      if (d === undefined) return [];
      return [
        {
          proposalId: row.proposalId,
          action: d.action,
          ...(d.action === 'edit' && d.text !== undefined ? { description: d.text } : {}),
          ...(d.action === 'edit' && d.dueDate !== undefined ? { dueDate: d.dueDate } : {}),
          ...(d.action === 'edit' && d.ownerMemberId !== undefined
            ? { ownerMemberId: d.ownerMemberId }
            : {}),
          ...(d.action === 'dismiss' && d.reason !== undefined ? { reason: d.reason } : {}),
        },
      ];
    }),
    tasks: proposal.tasks.flatMap((row) => {
      const d = draft.tasks[row.proposalId];
      if (d === undefined) return [];
      return [
        {
          proposalId: row.proposalId,
          action: d.action,
          ...(d.action === 'edit' && d.text !== undefined ? { title: d.text } : {}),
          ...(d.action === 'dismiss' && d.reason !== undefined ? { reason: d.reason } : {}),
        },
      ];
    }),
  };
}
