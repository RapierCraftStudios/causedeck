// Server-only seam between the enquiry screens and the intake services (#874, #87 part 2). The
// services take `IntakeDeps` and open the actor's workspace scope themselves; the app hands them the
// transaction it already holds (`inWorkspace` here, `ctx.tx` in server actions) and never imports
// `db` (#298). The page has already checked the `intake.enquiry_log` flag (a dark feature is a 404),
// so a `FeatureDisabledError` from core is only a backstop and reads as a denial.
import type { EnquiryConflictCheck, EnquiryView, IntakeDeps } from '@causedeck/core/intake';
import type { Transaction } from '@causedeck/core/runtime';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

/** The intake deps for a transaction the caller already opened. */
export function intakeDeps(tx: Transaction): IntakeDeps {
  return { db: tx };
}

/** What an enquiry row shows; the contact details stay on the server's list read. */
export interface EnquiryRowView {
  id: string;
  status: EnquiryView['status'];
  channel: EnquiryView['channel'];
  enquirerName: string;
  summary: string;
  practiceArea: string | null;
  receivedAt: string;
  closedReason: string | null;
  hasProposal: boolean;
  parties: EnquiryView['parties'];
}

export function toEnquiryRowView(enquiry: EnquiryView): EnquiryRowView {
  return {
    id: enquiry.id,
    status: enquiry.status,
    channel: enquiry.channel,
    enquirerName: enquiry.enquirerName,
    summary: enquiry.summary,
    practiceArea: enquiry.practiceArea,
    receivedAt: enquiry.receivedAt.toISOString(),
    closedReason: enquiry.closedReason,
    hasProposal: enquiry.proposalId !== null,
    parties: enquiry.parties,
  };
}

/** A conflict run as the client gets it: hits to weigh, never a verdict. */
export interface ConflictCheckView {
  checkedAt: string;
  partyCount: number;
  hits: {
    checked: string;
    side: string;
    matterId: string;
    matterTitle: string;
    matchedName: string;
    existingRole: 'client' | 'adverse';
    score: number;
    reason: string;
  }[];
}

export function toConflictCheckView(check: EnquiryConflictCheck): ConflictCheckView {
  return {
    checkedAt: check.checkedAt.toISOString(),
    partyCount: check.partyCount,
    hits: check.hits.map((hit) => ({
      checked: hit.checked,
      side: hit.side,
      matterId: hit.matterId,
      matterTitle: hit.matterTitle,
      matchedName: hit.matchedName,
      existingRole: hit.existingRole,
      score: hit.score,
      reason: hit.reason,
    })),
  };
}

export type EnquiriesLoad =
  { kind: 'list'; enquiries: EnquiryView[] } | { kind: 'denied' } | { kind: 'error' };

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** The workspace's enquiries for the member; a denial and a failure are results, never a throw. */
export async function loadEnquiries(context: WorkspaceContext): Promise<EnquiriesLoad> {
  try {
    const [runtime, intake] = await Promise.all([
      import('@causedeck/core/runtime'),
      import('@causedeck/core/intake'),
    ]);
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    const enquiries = await runtime.inWorkspace(scope, (tx) =>
      intake.listEnquiries(intakeDeps(tx), scope),
    );
    return { kind: 'list', enquiries };
  } catch (error) {
    if (codeOf(error) === 'FORBIDDEN') return { kind: 'denied' };
    logger.error({ err: error }, 'enquiries page: could not load the enquiries');
    return { kind: 'error' };
  }
}
