// The source registry (#478, D-048): the single place that decides whether, how and how often
// CauseDeck may read an external source (a court page, a notices page, a news feed, a licensed API
// or a corpus). `source` is a global table staff manage through the admin console; reads here fail
// closed: an unknown, uncleared or killed source gives no policy, so nothing is fetched.
// `access_mode_registry` (D-028) stays the per-resource table for court adapters (ADR 0011).
import { db as appDb, schema, withUser, type Queryable, type Transaction } from '@causedeck/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { record, type AuditMetadataValue } from '../audit/index.ts';

const { source, staffUser } = schema;

export const SOURCE_KINDS = schema.SOURCE_KINDS;
export const SOURCE_ACCESS_MODES = schema.SOURCE_ACCESS_MODES;
export const SOURCE_REVIEW_STATUSES = schema.SOURCE_REVIEW_STATUSES;
export const SOURCE_MAX_TIERS = schema.SOURCE_MAX_TIERS;
export const SOURCE_DATA_CLASSES = schema.SOURCE_DATA_CLASSES;
export type SourceKind = schema.SourceKind;
export type SourceDataClass = schema.SourceDataClass;
export type SourceAccessMode = schema.SourceAccessMode;
export type SourceReviewStatus = schema.SourceReviewStatus;
export type SourceMaxTier = schema.SourceMaxTier;

/** Whether records of a source with this data class may be served through the API (D-048): only `non-personal`. */
export function exposableThroughApi(dataClass: SourceDataClass): boolean {
  return dataClass === 'non-personal';
}

/** Why a source gave no policy. */
export type SourceDenial = 'unknown' | 'uncleared' | 'killed';

/** Thrown by `policyFor` for an unknown, uncleared or killed source: the caller must not fetch. */
export class SourceNotCleared extends Error {
  readonly code = 'SOURCE_NOT_CLEARED' as const;
  readonly reason: SourceDenial;
  readonly sourceId: string;

  constructor(reason: SourceDenial, sourceId: string) {
    super(`Source ${sourceId} is not cleared: ${reason}`);
    this.name = 'SourceNotCleared';
    this.reason = reason;
    this.sourceId = sourceId;
  }
}

export type SourceAdminErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID';

/** A staff change the registry refused. */
export class SourceAdminError extends Error {
  constructor(
    readonly code: SourceAdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SourceAdminError';
  }
}

/** What a caller may do with a cleared source. */
export interface SourcePolicy {
  sourceId: string;
  kind: SourceKind;
  baseUrl: string;
  accessMode: SourceAccessMode;
  rateLimitPerMinute: number;
  retentionDays: number;
  residency: string;
  /** DPDP data class of the source's records. */
  dataClass: SourceDataClass;
  /** The costliest AlterLab tier the fetch layer may use. */
  maxTier: SourceMaxTier;
  maxCostDollars: number;
  /** Counsel has cleared bulk captcha solving for this source (D-048); read-only here, set by staff in SQL. */
  captchaBulkCleared: boolean;
  /** The approval reference recorded with the clearance (#492); bulk solving needs it as well. */
  captchaBulkApprovalRef: string | null;
  /** The registry row's version (`updated_at`, ISO), recorded in fetch provenance. */
  version: string;
}

/** One `source` row, as the admin console lists and edits it. */
export interface SourceRecord extends Omit<SourcePolicy, 'sourceId' | 'version'> {
  id: string;
  owner: string;
  termsStatus: SourceReviewStatus;
  counselStatus: SourceReviewStatus;
  clearedAt: Date | null;
  killSwitch: boolean;
  notes: string | null;
  updatedAt: Date;
}

/** Kinds that are courts or government pages: never fetched through a captcha tier. */
const NO_CAPTCHA_KINDS: readonly SourceKind[] = schema.NO_CAPTCHA_KINDS;

/** Throw `SourceAdminError` (`INVALID`) when the kind and tier break a bright line (also a CHECK). */
export function validateSourceTier(kind: SourceKind, maxTier: SourceMaxTier): void {
  if (maxTier === 'captcha' && NO_CAPTCHA_KINDS.includes(kind)) {
    throw new SourceAdminError('INVALID', `A ${kind} source cannot use the captcha tier`);
  }
}

export interface SourceClearanceRow {
  termsStatus: SourceReviewStatus;
  counselStatus: SourceReviewStatus;
  clearedAt: Date | null;
  killSwitch: boolean;
}

/** Pure clearance decision: `null` when the source may be fetched, else why not. */
export function decideSourceClearance(row: SourceClearanceRow | undefined): SourceDenial | null {
  if (row === undefined) return 'unknown';
  if (row.killSwitch) return 'killed';
  if (row.termsStatus !== 'cleared' || row.counselStatus !== 'cleared' || row.clearedAt === null) {
    return 'uncleared';
  }
  return null;
}

/**
 * The policy of a cleared source. Throws `SourceNotCleared` for an unknown, uncleared or killed
 * one. `source` is a global table, readable in any scope.
 */
export async function policyFor(
  sourceId: string,
  { db = appDb }: { db?: Queryable } = {},
): Promise<SourcePolicy> {
  const [row] = await db.select().from(source).where(eq(source.id, sourceId)).limit(1);
  const denial = decideSourceClearance(row);
  if (denial !== null || row === undefined)
    throw new SourceNotCleared(denial ?? 'unknown', sourceId);
  return {
    sourceId: row.id,
    kind: row.kind,
    baseUrl: row.baseUrl,
    accessMode: row.accessMode,
    rateLimitPerMinute: row.rateLimitPerMinute,
    retentionDays: row.retentionDays,
    residency: row.residency,
    dataClass: row.dataClass,
    maxTier: row.maxTier,
    maxCostDollars: Number(row.maxCostDollars),
    captchaBulkCleared: row.captchaBulkCleared,
    captchaBulkApprovalRef: row.captchaBulkApprovalRef,
    version: row.updatedAt.toISOString(),
  };
}

/** Whether `sourceId` may be fetched. Fails closed: any error (not just `SourceNotCleared`) is `false`. */
export async function isCleared(sourceId: string, deps: { db?: Queryable } = {}): Promise<boolean> {
  try {
    await policyFor(sourceId, deps);
    return true;
  } catch {
    return false;
  }
}

function toRecord(row: typeof source.$inferSelect): SourceRecord {
  return {
    id: row.id,
    kind: row.kind,
    baseUrl: row.baseUrl,
    owner: row.owner,
    accessMode: row.accessMode,
    termsStatus: row.termsStatus,
    counselStatus: row.counselStatus,
    clearedAt: row.clearedAt,
    rateLimitPerMinute: row.rateLimitPerMinute,
    retentionDays: row.retentionDays,
    residency: row.residency,
    dataClass: row.dataClass,
    maxTier: row.maxTier,
    maxCostDollars: Number(row.maxCostDollars),
    captchaBulkCleared: row.captchaBulkCleared,
    captchaBulkApprovalRef: row.captchaBulkApprovalRef,
    killSwitch: row.killSwitch,
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

/** Every source ordered by id, for the admin console. Read-only; `source` is a global table. */
export async function listSources(db: Queryable): Promise<SourceRecord[]> {
  const rows = await db.select().from(source).orderBy(asc(source.id));
  return rows.map(toRecord);
}

/** The editable fields of a source. */
export interface SourceInput {
  kind: SourceKind;
  baseUrl: string;
  owner: string;
  accessMode: SourceAccessMode;
  termsStatus: SourceReviewStatus;
  counselStatus: SourceReviewStatus;
  rateLimitPerMinute: number;
  retentionDays: number;
  residency: string;
  /** Defaults to the stored value on update and to `personal` on create. */
  dataClass?: SourceDataClass;
  maxTier: SourceMaxTier;
  maxCostDollars: number;
  killSwitch: boolean;
  notes: string | null;
}

export type SourceChange = Partial<SourceInput>;

/** The staff member making a change; `asSourceStaff` is the only way to build one. */
export interface SourceActor {
  userId: string;
}

export function asSourceStaff(userId: string): SourceActor {
  return { userId };
}

const SOURCE_ID = /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)*$/;
const FIELDS = [
  'kind',
  'baseUrl',
  'owner',
  'accessMode',
  'termsStatus',
  'counselStatus',
  'rateLimitPerMinute',
  'retentionDays',
  'residency',
  'dataClass',
  'maxTier',
  'maxCostDollars',
  'killSwitch',
  'notes',
] as const satisfies readonly (keyof SourceInput)[];

function invalid(message: string): never {
  throw new SourceAdminError('INVALID', message);
}

/** Validate the whole (merged) source: bright lines first, then limits and the URL. */
export function validateSourceInput(input: SourceInput): void {
  validateSourceTier(input.kind, input.maxTier);
  if (!Number.isInteger(input.rateLimitPerMinute) || input.rateLimitPerMinute < 1) {
    invalid('The rate limit must be a whole number of at least 1 per minute');
  }
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 0) {
    invalid('Retention must be a whole number of days, 0 or more');
  }
  if (!Number.isFinite(input.maxCostDollars) || input.maxCostDollars < 0) {
    invalid('The cost cap must be 0 or more');
  }
  if (input.dataClass !== undefined && !SOURCE_DATA_CLASSES.includes(input.dataClass)) {
    invalid('The data class must be personal, non-personal or mixed');
  }
  if (input.owner.trim() === '' || input.residency.trim() === '') {
    invalid('Owner and residency are required');
  }
  if (!/^urn:causedeck:adapter:/.test(input.baseUrl)) {
    let url: URL | undefined;
    try {
      url = new URL(input.baseUrl);
    } catch {
      // handled below
    }
    if (url === undefined || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      invalid('The base URL must be an http(s) URL');
    }
  }
}

async function assertSourceStaff(tx: Transaction, actor: SourceActor): Promise<void> {
  const [row] = await tx
    .select({ userId: staffUser.userId })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.userId, actor.userId),
        inArray(staffUser.role, ['ops', 'admin']),
        isNull(staffUser.disabledAt),
      ),
    );
  if (!row) throw new SourceAdminError('FORBIDDEN', 'Only ops or admin staff can change sources');
}

function auditValue(value: unknown): AuditMetadataValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

function inputOf(row: SourceRecord): SourceInput {
  return {
    kind: row.kind,
    baseUrl: row.baseUrl,
    owner: row.owner,
    accessMode: row.accessMode,
    termsStatus: row.termsStatus,
    counselStatus: row.counselStatus,
    rateLimitPerMinute: row.rateLimitPerMinute,
    retentionDays: row.retentionDays,
    residency: row.residency,
    dataClass: row.dataClass,
    maxTier: row.maxTier,
    maxCostDollars: row.maxCostDollars,
    killSwitch: row.killSwitch,
    notes: row.notes,
  };
}

/**
 * `source.changed` with every changed field's old and new value (`old_<field>`, `new_<field>`;
 * null when the source did not exist), in the caller's transaction so a failed audit rolls back.
 */
function auditChange(
  tx: Transaction,
  actor: SourceActor,
  sourceId: string,
  change: 'created' | 'updated' | 'kill_switch',
  old: SourceInput | null,
  next: SourceInput,
): Promise<void> {
  const changed = FIELDS.filter((f) => old === null || old[f] !== next[f]);
  const metadata: Record<string, AuditMetadataValue> = { change, fields: changed.join(',') };
  for (const f of changed) {
    metadata[`old_${f}`] = old === null ? null : auditValue(old[f]);
    metadata[`new_${f}`] = auditValue(next[f]);
  }
  return record(
    { db: tx, workspaceId: null, actor: { userId: actor.userId, kind: 'staff' } },
    { action: 'source.changed', target: { kind: 'source', id: sourceId }, metadata },
  );
}

/** Clearance is stamped when terms and counsel are both cleared, and cleared again otherwise. */
function clearedAtFor(next: SourceInput, previous: Date | null): Date | null {
  if (next.termsStatus !== 'cleared' || next.counselStatus !== 'cleared') return null;
  return previous ?? new Date();
}

/** Add a source (staff only), audited. New sources default to uncleared. */
export async function createSource(
  db: Queryable,
  actor: SourceActor,
  sourceId: string,
  input: SourceInput,
): Promise<SourceRecord> {
  if (!SOURCE_ID.test(sourceId)) invalid('The source id must be a lowercase dotted slug');
  validateSourceInput(input);
  return withUser(db, { userId: actor.userId }, async (tx) => {
    await assertSourceStaff(tx, actor);
    const [existing] = await tx
      .select({ id: source.id })
      .from(source)
      .where(eq(source.id, sourceId));
    if (existing) throw new SourceAdminError('ALREADY_EXISTS', `Source ${sourceId} already exists`);
    const [row] = await tx
      .insert(source)
      .values({
        ...input,
        id: sourceId,
        maxCostDollars: String(input.maxCostDollars),
        clearedAt: clearedAtFor(input, null),
        updatedBy: actor.userId,
      })
      .returning();
    if (!row) throw new Error('createSource: insert returned no row');
    await auditChange(tx, actor, sourceId, 'created', null, input);
    return toRecord(row);
  });
}

async function applyChange(
  db: Queryable,
  actor: SourceActor,
  sourceId: string,
  change: SourceChange,
  kind: 'updated' | 'kill_switch',
): Promise<SourceRecord> {
  return withUser(db, { userId: actor.userId }, async (tx) => {
    await assertSourceStaff(tx, actor);
    const [current] = await tx.select().from(source).where(eq(source.id, sourceId)).for('update');
    if (!current) throw new SourceAdminError('NOT_FOUND', `No source ${sourceId}`);
    const old = inputOf(toRecord(current));
    const next: SourceInput = { ...old, ...change };
    validateSourceInput(next);
    const [row] = await tx
      .update(source)
      .set({
        ...next,
        maxCostDollars: String(next.maxCostDollars),
        clearedAt: clearedAtFor(next, current.clearedAt),
        updatedBy: actor.userId,
      })
      .where(eq(source.id, sourceId))
      .returning();
    if (!row) throw new Error('updateSource: update returned no row');
    await auditChange(tx, actor, sourceId, kind, old, next);
    return toRecord(row);
  });
}

/** Edit a source (staff only), audited with the old and new value of every changed field. */
export function updateSource(
  db: Queryable,
  actor: SourceActor,
  sourceId: string,
  change: SourceChange,
): Promise<SourceRecord> {
  return applyChange(db, actor, sourceId, change, 'updated');
}

/** Flip a source's kill switch (staff only), audited. On means no fetch, whatever its clearance. */
export function setSourceKillSwitch(
  db: Queryable,
  actor: SourceActor,
  sourceId: string,
  killSwitch: boolean,
): Promise<SourceRecord> {
  return applyChange(db, actor, sourceId, { killSwitch }, 'kill_switch');
}
