// Citation checker service (#77, DR-2). `checkDraft` extracts the citations of one immutable draft
// version, resolves them through the configured resolver under the workspace's rate limit and daily
// budget, classifies each and upserts one `authority` row per citation (idempotent on
// `(draft_version_id, block_id, span)`). Statuses belong to the version: a new version has no rows
// until it is checked, so a stale status is never shown as current. Only the citation string, the
// status, a canonical URL and a short title are stored. Draft text never reaches a log; citation
// strings are logged at debug level only, without matter identifiers.
import {
  checkCitations,
  createMockResolver,
  extractCitations,
  validateBlockTree,
  type Block,
  type CitationResolver,
  type ExtractedCitation,
  type RateLimiter,
} from '@causedeck/drafting';
import { isUuid, schema, withWorkspace, type Queryable, type Transaction } from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import type {
  CitationKind,
  CitationReason,
  CitationReport,
  CitationStatus,
} from '@causedeck/validators/citation';
import { and, eq, gte, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { invalid, notFound } from '../shared/errors.ts';

import { asDraftMember, requireDraft, type DraftActor } from './policy.ts';

const { authority, draftVersion } = schema;

function blocksOf(content: unknown): Block[] {
  const parsed = validateBlockTree(content);
  if (!parsed.ok) throw invalid('Invalid draft content');
  return parsed.blocks;
}

/** A member (access is checked) or the job runner acting for the workspace. */
export type CitationActor = DraftActor | { workspaceId: string; system: true };

export interface CheckDraftDeps {
  db: Queryable;
  /** The mock (offline) resolver when omitted. */
  resolver?: CitationResolver;
  limiter?: RateLimiter;
  /** External resolver calls a workspace may make per IST day; unlimited when omitted. */
  dailyBudget?: number;
  now?: () => Date;
  log?: Pick<Logger, 'debug' | 'info'>;
}

export type AuthorityRow = typeof authority.$inferSelect;

const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Rows whose last check should be repeated: a throttle or an outage is not an answer. */
const RETRYABLE: readonly CitationReason[] = ['throttled', 'resolver_unavailable'];

const spanKey = (blockId: string, span: readonly [number, number]) =>
  `${blockId}:${String(span[0])}-${String(span[1])}`;

function isSystem(actor: CitationActor): actor is { workspaceId: string; system: true } {
  return 'system' in actor;
}

interface LoadedVersion {
  blocks: Block[];
  rows: AuthorityRow[];
  usedToday: number;
}

async function loadVersion(
  tx: Transaction,
  workspaceId: string,
  draftVersionId: string,
  dayStart: Date,
  sourceName: string,
): Promise<{ draftId: string } & LoadedVersion> {
  const [version] = await tx
    .select({ draftId: draftVersion.draftId, content: draftVersion.content })
    .from(draftVersion)
    .where(and(eq(draftVersion.workspaceId, workspaceId), eq(draftVersion.id, draftVersionId)))
    .limit(1);
  if (version === undefined) throw notFound('Version not found');
  const rows = await tx
    .select()
    .from(authority)
    .where(
      and(eq(authority.workspaceId, workspaceId), eq(authority.draftVersionId, draftVersionId)),
    );
  const [used] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(authority)
    .where(
      and(
        eq(authority.workspaceId, workspaceId),
        gte(authority.checkedAt, dayStart),
        sql`${authority.resolution}->>'source' = ${sourceName}`,
      ),
    );
  return {
    draftId: version.draftId,
    blocks: blocksOf(version.content),
    rows,
    usedToday: used?.n ?? 0,
  };
}

export function reportFromRows(
  draftVersionId: string,
  rows: readonly AuthorityRow[],
): CitationReport {
  const counts = { verified: 0, not_found: 0, unknown: 0 };
  let throttled = 0;
  const items = [...rows]
    .sort((a, b) => a.blockId.localeCompare(b.blockId) || a.span[0] - b.span[0])
    .map((row) => {
      const status = row.status as CitationStatus;
      counts[status] += 1;
      if (row.resolution.reason === 'throttled') throttled += 1;
      return {
        id: row.id,
        blockId: row.blockId,
        span: row.span,
        raw: row.rawText,
        normalized: row.normalized,
        kind: row.kind as CitationKind,
        status,
        ...(row.sourceUrl === null ? {} : { sourceUrl: row.sourceUrl }),
        ...(row.resolution.title === undefined ? {} : { title: row.resolution.title }),
        ...(row.resolution.reason === undefined
          ? {}
          : { reason: row.resolution.reason as CitationReason }),
      };
    });
  return { draftVersionId, items, counts, throttled };
}

async function readRows(tx: Transaction, workspaceId: string, draftVersionId: string) {
  return tx
    .select()
    .from(authority)
    .where(
      and(eq(authority.workspaceId, workspaceId), eq(authority.draftVersionId, draftVersionId)),
    );
}

/**
 * Check the citations of one draft version and store the result. A member needs `draft.write` on the
 * draft; the job passes `{ workspaceId, system: true }`. Citations already answered (not throttled
 * and not unavailable) are kept, so a rerun resolves only what is still open.
 */
export async function checkDraft(
  deps: CheckDraftDeps,
  actor: CitationActor,
  draftVersionId: string,
): Promise<CitationReport> {
  const { workspaceId } = actor;
  if (!isUuid(workspaceId) || !isUuid(draftVersionId)) throw notFound('Version not found');
  const now = deps.now ?? (() => new Date());
  const resolver = deps.resolver ?? createMockResolver();
  const dayStart = new Date(`${IST_DAY.format(now())}T00:00:00+05:30`);

  const loaded = isSystem(actor)
    ? await withWorkspace(deps.db, { workspaceId }, (tx) =>
        loadVersion(tx, workspaceId, draftVersionId, dayStart, resolver.name),
      )
    : await asDraftMember(deps.db, actor, async (tx, reader, settings) => {
        const found = await loadVersion(tx, workspaceId, draftVersionId, dayStart, resolver.name);
        await requireDraft(tx, reader, settings, found.draftId, 'draft.write');
        return found;
      });

  const stored = new Map(loaded.rows.map((row) => [spanKey(row.blockId, row.span), row]));
  const open: ExtractedCitation[] = [];
  const all = extractCitations(loaded.blocks);
  for (const item of all) {
    const row = stored.get(spanKey(item.blockId, item.span));
    const reason = row?.resolution.reason as CitationReason | undefined;
    if (row === undefined || (reason !== undefined && RETRYABLE.includes(reason))) open.push(item);
  }

  const checked = await checkCitations(open, {
    resolver,
    workspaceId,
    ...(deps.limiter ? { limiter: deps.limiter } : {}),
    ...(deps.dailyBudget === undefined
      ? {}
      : { budgetRemaining: Math.max(0, deps.dailyBudget - loaded.usedToday) }),
  });
  for (const item of checked)
    deps.log?.debug({ citation: item.normalized, status: item.verdict.status }, 'citation checked');

  const checkedAt = now();
  const rows = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    for (const item of checked) {
      const { verdict } = item;
      const resolution = {
        ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
        ...(verdict.title === undefined ? {} : { title: verdict.title }),
        ...(verdict.similarity === undefined ? {} : { similarity: verdict.similarity }),
        ...(item.resolved ? { source: resolver.name } : {}),
      };
      const values = {
        workspaceId,
        draftVersionId,
        blockId: item.blockId,
        span: item.span,
        rawText: item.raw,
        normalized: item.normalized,
        kind: item.kind,
        resolution,
        status: verdict.status,
        sourceUrl: verdict.sourceUrl ?? null,
        checkedAt,
      };
      await tx
        .insert(authority)
        .values(values)
        .onConflictDoUpdate({
          target: [authority.draftVersionId, authority.blockId, authority.span],
          set: {
            rawText: values.rawText,
            normalized: values.normalized,
            kind: values.kind,
            resolution: values.resolution,
            status: values.status,
            sourceUrl: values.sourceUrl,
            checkedAt: values.checkedAt,
          },
        });
    }
    const current = await readRows(tx, workspaceId, draftVersionId);
    const report = reportFromRows(draftVersionId, current);
    await record(
      {
        db: tx,
        workspaceId,
        actor: isSystem(actor)
          ? { userId: null, kind: 'system' }
          : { userId: actor.userId, kind: 'user' },
      },
      {
        action: 'draft.citations.checked',
        target: { kind: 'draft_version', id: draftVersionId },
        metadata: { ...report.counts, throttled: report.throttled, total: report.items.length },
      },
    );
    return current;
  });
  deps.log?.info(
    { workspaceId, draftVersionId, citations: rows.length },
    'draft citations checked',
  );
  return reportFromRows(draftVersionId, rows);
}

/** The stored statuses of one version (`draft.read`); nothing is resolved. */
export async function getCitationReport(
  deps: { db: Queryable },
  actor: DraftActor,
  input: { draftVersionId: string },
): Promise<CitationReport> {
  if (!isUuid(input.draftVersionId)) throw notFound('Version not found');
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const [version] = await tx
      .select({ draftId: draftVersion.draftId })
      .from(draftVersion)
      .where(
        and(
          eq(draftVersion.workspaceId, reader.workspaceId),
          eq(draftVersion.id, input.draftVersionId),
        ),
      )
      .limit(1);
    if (version === undefined) throw notFound('Version not found');
    await requireDraft(tx, reader, settings, version.draftId, 'draft.read');
    return reportFromRows(
      input.draftVersionId,
      await readRows(tx, reader.workspaceId, input.draftVersionId),
    );
  });
}
