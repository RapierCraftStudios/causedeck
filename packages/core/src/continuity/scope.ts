// Shared plumbing of the continuity files (#71): the scope, the deps and the line helpers. Handover
// and what-changed import this module, never each other. Read and write inside the actor's workspace
// scope; the role comes from the membership row (never the caller) and `can()` decides.
import { isRole } from '@causedeck/auth';
import { can, type Actor, type PolicySettings } from '@causedeck/auth/policy';
import {
  currentScope,
  isUuid,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import { hasProvenance, type BriefLine } from '@causedeck/validators';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { record, type AuditAction } from '../audit/index.ts';
import type { MemoryProvider } from '../briefs/index.ts';
import { crossWorkspace } from '../matter-graph/index.ts';
import { forbidden, invalid, notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

export interface ContinuityDeps {
  db: Database | Transaction;
  /** Policy settings; the workspace's stored role settings apply when omitted. */
  settings?: PolicySettings;
  /** The memory port (M3 synopsis); empty until it is wired. */
  memory?: MemoryProvider;
  now?: () => Date;
}

export interface ContinuityActor {
  workspaceId: string;
  userId: string;
}

export interface ContinuityScope {
  tx: Transaction;
  actor: Actor;
  /** The actor's membership id (`member.id`). */
  memberId: string;
  deps: ContinuityDeps;
  now: Date;
  settings: () => Promise<PolicySettings>;
}

/** The parsed input, or VALIDATION with the first issue's message. */
export function parseContinuityInput<S extends z.ZodType>(
  schemaOf: S,
  input: unknown,
): z.output<S> {
  const parsed = schemaOf.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw invalid(`${where}${issue?.message ?? 'Invalid input'}`);
  }
  return parsed.data;
}

/** Run `fn` in the actor's workspace scope. */
export async function inContinuityScope<T>(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  fn: (scope: ContinuityScope) => Promise<T>,
): Promise<T> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) throw notFound('Workspace not found');
  const outer = currentScope();
  if (
    outer?.kind === 'workspace' &&
    outer.workspaceId?.toLowerCase() !== actor.workspaceId.toLowerCase()
  ) {
    throw crossWorkspace();
  }
  const { workspaceId, userId } = actor;
  return withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Workspace not found');
    const [self] = await tx
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, userId)))
      .limit(1);
    if (self === undefined) throw notFound('Workspace not found');
    let settings: PolicySettings | undefined = deps.settings;
    return fn({
      tx,
      actor: { userId, workspaceId, role },
      memberId: self.id,
      deps,
      now: (deps.now ?? (() => new Date()))(),
      settings: async () => (settings ??= toPolicySettings(await getRoleSettings(tx, workspaceId))),
    });
  });
}

export async function mayDoContinuity(
  scope: ContinuityScope,
  action: Parameters<typeof can>[1],
): Promise<boolean> {
  return can(scope.actor, action, undefined, await scope.settings()).allow;
}

/** FORBIDDEN unless the actor's role may `action` (no resource). */
export async function requireContinuityAction(
  scope: ContinuityScope,
  action: Parameters<typeof can>[1],
  message: string,
): Promise<void> {
  if (!(await mayDoContinuity(scope, action))) throw forbidden(message);
}

/** The matter, or NOT_FOUND (RLS hides another workspace's). */
export async function loadMatter(scope: ContinuityScope, matterId: string) {
  const [row] = await scope.tx
    .select()
    .from(schema.matter)
    .where(
      and(eq(schema.matter.workspaceId, scope.actor.workspaceId), eq(schema.matter.id, matterId)),
    )
    .limit(1);
  if (row === undefined) throw notFound('Matter not found');
  return row;
}

/** The provenance fields of a docket row, with the numeric confidence as a number. */
export function continuityProvenanceOf(row: {
  sourceType: BriefLine['source_type'];
  sourceRef: string | null;
  anchorId: string | null;
  confidence: string | null;
  confirmationState: BriefLine['confirmation_state'];
}): Pick<
  BriefLine,
  'source_type' | 'source_ref' | 'anchor_id' | 'confidence' | 'confirmation_state'
> {
  return {
    source_type: row.sourceType,
    source_ref: row.sourceRef,
    anchor_id: row.anchorId,
    confidence: row.confidence === null ? null : Number(row.confidence),
    confirmation_state: row.confirmationState,
  };
}

/** A line citing a document row: documents carry no provenance columns, so the document is the source. */
export function documentLine(document: { id: string }, text: string): BriefLine {
  return {
    text,
    label: null,
    page_no: null,
    quote: null,
    source_type: 'document',
    source_ref: `document:${document.id}`,
    anchor_id: null,
    confidence: null,
    confirmation_state: 'confirmed',
  };
}

/** Keep only lines that carry provenance: no provenance, no line. */
export function withContinuityProvenance<L extends Parameters<typeof hasProvenance>[0]>(
  lines: L[],
): L[] {
  return lines.filter(hasProvenance);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-20` as `20 Oct`. */
export function continuityShortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${String(Number(d))} ${MONTHS[Number(m) - 1] ?? ''}`;
}

/** The India-time calendar day of `now`. */
export function continuityIstDay(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** One informational audit event: ids only, never note text. */
export async function auditContinuity(
  scope: ContinuityScope,
  action: AuditAction,
  target: { kind: string; id: string },
): Promise<void> {
  await record(
    {
      db: scope.tx,
      workspaceId: scope.actor.workspaceId,
      actor: { userId: scope.actor.userId, kind: 'user' },
    },
    { action, target },
  );
}
