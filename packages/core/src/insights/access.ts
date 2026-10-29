// Who sees what of the practice report (#85): owner and advocates read workspace totals (and may
// narrow to one member); a junior sees only their own appearances and measures; a clerk or viewer
// sees none (FORBIDDEN). A stranger to the workspace is NOT_FOUND, as everywhere in `pov`.
import { forbidden } from '../shared/errors.ts';
import { requirePovMember, type PovActor, type PovDeps } from '../pov/index.ts';

export type InsightsActor = PovActor;
export type InsightsDeps = PovDeps;

export interface InsightsViewer {
  /** `workspace` totals, or `own`: the viewer's own rows only. */
  scope: 'workspace' | 'own';
  /** The member whose rows count, or null for the whole workspace. */
  memberId: string | null;
}

/** Resolve the viewer's scope for a requested member filter. */
export async function insightsViewer(
  deps: InsightsDeps,
  actor: InsightsActor,
  requestedMemberId: string | undefined,
): Promise<InsightsViewer> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role === 'owner' || who.role === 'advocate')
    return { scope: 'workspace', memberId: requestedMemberId ?? null };
  if (who.role === 'junior') {
    if (requestedMemberId !== undefined && requestedMemberId !== who.memberId) throw forbidden();
    return { scope: 'own', memberId: who.memberId };
  }
  throw forbidden('Practice insights are not available to this role');
}
