// The orders poll (#494, D-048): the body of the system `orders.poll` job. For a watched matter
// whose latest status snapshot lists an order with a link we have not captured, fetch that order as
// a delegated lookup (the watch's own advocate and matter, through the governed fetch layer, never
// a call without `delegatedFor`) and store it as a capture, so the capture pipeline and
// `extraction.extract-order` read it and stage its directions as L2 proposals. The caps, the skip of
// an uncleared or killed source and the rate-limit deferral are those of `pollCaseWatches`. A
// capture is de-duplicated by order URL and by sha256 within the workspace. A sensitive matter is
// never auto-captured. Only ids and counts are logged.
import { createHash, randomUUID } from 'node:crypto';

import type { ParsedCaseStatus } from '@causedeck/adapters';
import {
  CAPTURE_PIPELINE_VERSION,
  assertWithinCap,
  resolveAllowedType,
  transition,
  type CaptureConfig,
} from '@causedeck/capture';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { objectKey, type ObjectStore } from '@causedeck/storage';
import { and, desc, eq, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import type { CaptureJobs } from '../capture/index.ts';
import { SourceNotCleared, policyFor } from '../sources/index.ts';

import {
  MAX_PER_ADVOCATE_PER_RUN,
  MAX_PER_SOURCE_PER_RUN,
  MAX_WATCHES_PER_RUN,
  type DueWatch,
} from './poll.ts';
import type { StatusFetcher } from './lookup.ts';

const { blob, capture, caseStatusSnapshot, caseWatch, matter, proceeding } = schema;

type Db = Database | Transaction;

/** Orders fetched per watch per run (the newest first); the rest wait for the next tick. */
export const MAX_ORDERS_PER_WATCH_PER_RUN = 3;

export interface PollOrdersDeps {
  db: Db;
  fetcher: StatusFetcher;
  store: ObjectStore;
  config: CaptureConfig;
  jobs: CaptureJobs;
  /** The source's base URL; throws `SourceNotCleared` when it may not be fetched. Defaults to the registry. */
  policy?: (sourceId: string) => Promise<{ baseUrl: string }>;
  listDue?: (limit: number) => Promise<DueWatch[]>;
  caps?: { perAdvocate?: number; perSource?: number; total?: number };
  now?: () => Date;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface PollOrdersReport {
  due: number;
  /** Orders fetched and stored as captures. */
  captured: number;
  /** Orders already captured (same URL or same bytes). */
  duplicates: number;
  /** Watches not read this run (a cap or a rate limit); they stay due. */
  deferred: number;
  /** Watches not read because the source is uncleared or killed. */
  skipped: number;
  failed: number;
}

interface WatchOrders {
  matterId: string;
  sensitive: boolean;
  orders: { url: string; number: string | null; date: string | null }[];
}

async function defaultListDue(db: Db, limit: number): Promise<DueWatch[]> {
  const rows = await db.execute<{
    watch_id: string;
    workspace_id: string;
    advocate_user_id: string;
    source_id: string;
  }>(
    sql`select watch_id, workspace_id, advocate_user_id, source_id from app_case_watch_due(${limit})`,
  );
  return rows.map((r) => ({
    watchId: r.watch_id,
    workspaceId: r.workspace_id,
    advocateUserId: r.advocate_user_id,
    sourceId: r.source_id,
  }));
}

/** The `FetchDenied` of `@causedeck/fetch`, read structurally (core does not import it for types). */
function deniedReason(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, reason } = error as { code?: unknown; reason?: unknown };
  return code === 'FETCH_DENIED' && typeof reason === 'string' ? reason : null;
}

/** The order links of the watch's latest snapshot that no capture of the workspace holds yet, newest first. */
async function newOrders(db: Db, watch: DueWatch, baseUrl: string): Promise<WatchOrders | null> {
  const actor = { userId: watch.advocateUserId, workspaceId: watch.workspaceId };
  return withWorkspace(db, actor, async (tx) => {
    const [row] = await tx
      .select({
        fields: caseStatusSnapshot.fields,
        matterId: proceeding.matterId,
        sensitive: matter.sensitive,
      })
      .from(caseStatusSnapshot)
      .innerJoin(
        caseWatch,
        and(
          eq(caseWatch.workspaceId, caseStatusSnapshot.workspaceId),
          eq(caseWatch.id, caseStatusSnapshot.watchId),
        ),
      )
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, caseWatch.workspaceId),
          eq(proceeding.id, caseWatch.proceedingId),
        ),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .where(
        and(
          eq(caseStatusSnapshot.workspaceId, watch.workspaceId),
          eq(caseStatusSnapshot.watchId, watch.watchId),
          eq(caseWatch.advocateUserId, watch.advocateUserId),
        ),
      )
      .orderBy(desc(caseStatusSnapshot.fetchedAt), desc(caseStatusSnapshot.createdAt))
      .limit(1);
    if (row === undefined) return null;
    const listed = (row.fields as ParsedCaseStatus).orders ?? [];
    const orders: WatchOrders['orders'] = [];
    for (const o of listed) {
      if (o.href === null) continue;
      let url: string;
      try {
        url = new URL(o.href, baseUrl).toString();
      } catch {
        continue;
      }
      const [held] = await tx
        .select({ id: capture.id })
        .from(capture)
        .where(
          and(
            eq(capture.workspaceId, watch.workspaceId),
            sql`${capture.sourceMeta}->>'orderUrl' = ${url}`,
          ),
        )
        .limit(1);
      if (held === undefined) orders.push({ url, number: o.number, date: o.date });
    }
    orders.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return {
      matterId: row.matterId,
      sensitive: row.sensitive,
      orders: orders.slice(0, MAX_ORDERS_PER_WATCH_PER_RUN),
    };
  });
}

/** Store one fetched order as a capture for the advocate and queue it; false when the bytes are held already. */
async function storeOrder(
  deps: PollOrdersDeps,
  watch: DueWatch,
  matterId: string,
  order: WatchOrders['orders'][number],
  body: string,
): Promise<boolean> {
  const now = deps.now?.() ?? new Date();
  const bytes = Buffer.from(body, 'utf8');
  const tail = new URL(order.url).pathname.split('/').pop() ?? '';
  const filename = /\.[a-z0-9]{2,5}$/i.test(tail) ? tail : `${tail || 'order'}.pdf`;
  const type = resolveAllowedType(filename, 'application/pdf');
  assertWithinCap(type, bytes.byteLength, deps.config.sizeCapsBytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const scanning = deps.config.scan.clamav !== null;
  if (!scanning && deps.config.scan.required)
    throw new Error('scanning is required but unavailable');
  const scope = { userId: watch.advocateUserId, workspaceId: watch.workspaceId };

  return withWorkspace(deps.db, scope, async (tx) => {
    const [dup] = await tx
      .select({ id: capture.id })
      .from(capture)
      .where(and(eq(capture.workspaceId, watch.workspaceId), eq(capture.sha256, sha256)))
      .limit(1);
    if (dup !== undefined) return false;
    const blobId = randomUUID();
    const key = objectKey({ workspaceId: watch.workspaceId, kind: type.kind, id: blobId }, now);
    await deps.store.put({ key, body: bytes, contentType: type.mime });
    try {
      await tx.insert(blob).values({
        id: blobId,
        workspaceId: watch.workspaceId,
        key,
        kind: type.kind,
        filename,
        size: bytes.byteLength,
        sha256,
        mime: type.mime,
        scanStatus: scanning ? 'pending' : 'skipped',
        createdBy: watch.advocateUserId,
        createdAt: now,
        finalizedAt: now,
      });
      const next = transition(
        { status: 'received', sourceMeta: {} },
        scanning ? 'scanning' : 'queued',
        now,
      );
      const [row] = await tx
        .insert(capture)
        .values({
          workspaceId: watch.workspaceId,
          channel: 'bulk_import',
          status: next.status,
          rawStorageKey: key,
          sha256,
          mime: type.mime,
          sizeBytes: bytes.byteLength,
          originalFilename: filename,
          sourceMeta: {
            ...next.sourceMeta,
            orderUrl: order.url,
            watchId: watch.watchId,
            ...(order.number === null ? {} : { orderNumber: order.number }),
          },
          matterHintId: matterId,
          aiBlocked: false,
          scanStatus: scanning ? 'pending' : 'skipped',
          createdBy: watch.advocateUserId,
          createdAt: now,
        })
        .returning({ id: capture.id });
      if (row === undefined) throw new Error('capture insert returned no row');
      if (scanning) {
        await deps.jobs.scan({ workspaceId: watch.workspaceId, captureId: row.id, sha256 });
      } else {
        await deps.jobs.process({
          workspaceId: watch.workspaceId,
          captureId: row.id,
          pipelineVersion: CAPTURE_PIPELINE_VERSION,
        });
      }
      await record(
        {
          db: tx,
          workspaceId: watch.workspaceId,
          actor: { userId: watch.advocateUserId, kind: 'user' },
        },
        {
          action: 'capture.created',
          target: { kind: 'capture', id: row.id },
          metadata: {
            channel: 'bulk_import',
            mime: type.mime,
            sizeBytes: bytes.byteLength,
            aiBlocked: false,
          },
        },
      );
      return true;
    } catch (error) {
      await deps.store.delete(key).catch(() => undefined);
      throw error;
    }
  });
}

/** Ingest the new orders of every due watch once, each as its own advocate. One watch failing never stops the others. */
export async function pollOrders(deps: PollOrdersDeps): Promise<PollOrdersReport> {
  const perAdvocate = deps.caps?.perAdvocate ?? MAX_PER_ADVOCATE_PER_RUN;
  const perSource = deps.caps?.perSource ?? MAX_PER_SOURCE_PER_RUN;
  const total = deps.caps?.total ?? MAX_WATCHES_PER_RUN;
  const due = await (deps.listDue ?? ((limit) => defaultListDue(deps.db, limit)))(total);
  const report: PollOrdersReport = {
    due: due.length,
    captured: 0,
    duplicates: 0,
    deferred: 0,
    skipped: 0,
    failed: 0,
  };
  const bySource = new Map<string, number>();
  const byAdvocate = new Map<string, number>();
  const killedSources = new Set<string>();
  const limitedSources = new Set<string>();
  const limitedAdvocates = new Set<string>();
  const policy = deps.policy ?? ((id: string) => policyFor(id, { db: deps.db }));

  for (const watch of due) {
    const advocateKey = `${watch.workspaceId}:${watch.advocateUserId}`;
    if (killedSources.has(watch.sourceId)) {
      report.skipped += 1;
      continue;
    }
    if (
      limitedSources.has(watch.sourceId) ||
      limitedAdvocates.has(advocateKey) ||
      (bySource.get(watch.sourceId) ?? 0) >= perSource ||
      (byAdvocate.get(advocateKey) ?? 0) >= perAdvocate
    ) {
      report.deferred += 1;
      continue;
    }
    try {
      const { baseUrl } = await policy(watch.sourceId);
      const found = await newOrders(deps.db, watch, baseUrl);
      if (found === null || found.sensitive || found.orders.length === 0) continue;
      bySource.set(watch.sourceId, (bySource.get(watch.sourceId) ?? 0) + 1);
      byAdvocate.set(advocateKey, (byAdvocate.get(advocateKey) ?? 0) + 1);
      for (const order of found.orders) {
        const fetched = await deps.fetcher.fetchSource(watch.sourceId, order.url, {
          delegatedFor: { advocateId: watch.advocateUserId, matterId: found.matterId },
        });
        if (await storeOrder(deps, watch, found.matterId, order, fetched.body))
          report.captured += 1;
        else report.duplicates += 1;
      }
    } catch (error) {
      const denied = deniedReason(error);
      if (error instanceof SourceNotCleared) {
        killedSources.add(watch.sourceId);
        report.skipped += 1;
        deps.log?.('orders poll source not cleared', { sourceId: watch.sourceId });
      } else if (denied === 'source_rate_limited') {
        limitedSources.add(watch.sourceId);
        report.deferred += 1;
      } else if (denied === 'advocate_rate_limited') {
        limitedAdvocates.add(advocateKey);
        report.deferred += 1;
      } else {
        report.failed += 1;
        deps.log?.('orders poll failed', {
          watchId: watch.watchId,
          error: error instanceof Error ? error.name : 'error',
        });
      }
    }
  }
  return report;
}
