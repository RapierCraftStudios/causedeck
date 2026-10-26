// `drafting.export` body (#768): renders one draft version to DOCX or PDF with `@causedeck/drafting`,
// stores it encrypted under the workspace's `ws/<id>/export/` prefix (envelope encryption, the same
// store and keys as the workspace export) and records one `draft_export` row. Idempotent on
// `(draft_version_id, format)`: a second run returns the stored row and writes nothing. The file is
// only ever handed out as a short-lived presigned download (`createDraftExportDownload`); there is no
// email or share path. An unresolved slot blocks the export (`MissingSlotsError`). Narrative text is
// drafted through the gateway ports, so a refused non-India call writes its `ai_call` row. Logs carry
// ids, format and size, never draft text.
import {
  getPreset,
  renderDocx,
  renderPdf,
  type CourtFormatPreset,
  type NarrativePort,
} from '@causedeck/drafting';
import {
  schema,
  withWorkspace,
  type Database,
  type Queryable,
  type Transaction,
} from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import {
  createDownloadUrl,
  storeSystemBlob,
  type DownloadUrl,
  type KeyProvider,
  type ObjectKey,
  type ObjectStore,
} from '@causedeck/storage';
import type { CourtPreset, ExportFormat } from '@causedeck/validators/drafting';
import { and, eq } from 'drizzle-orm';

import { createCoreAiGateway } from '../ai/index.ts';
import { record } from '../audit/index.ts';
import { collectNarratives } from '@causedeck/drafting';
import { invalid, notFound } from '../shared/errors.ts';

import { assertCitationsClear, exportBlockedByCitations } from './citation-ack.ts';
import { asDraftMember, requireDraft, type DraftActor } from './policy.ts';
import { checkBlocksFor, draftNarratives, loadDraftFacts, type DraftExportRow } from './service.ts';

const { blob, draftExport, draftVersion, template } = schema;

export const EXPORT_MIME: Readonly<Record<ExportFormat, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

export interface DraftingExportCtx {
  db: Database | Transaction;
  store: ObjectStore;
  keys: KeyProvider;
  log: Pick<Logger, 'info' | 'warn'>;
  now?: () => Date;
  /** Narrative gateway; the core gateway on `db` when omitted. Only used for narrative blocks. */
  narrativePort?: NarrativePort;
}

export interface DraftingExportPayload {
  workspaceId: string;
  draftVersionId: string;
  format: ExportFormat;
  /** The member who asked for the export: the audit actor and the facts reader. */
  userId: string;
}

export interface DraftingExportResult {
  /** `existing` when an earlier run already stored this version and format. */
  status: 'exported' | 'existing';
  export: DraftExportRow;
}

/** A readable file name: ASCII words of the title, the version and the extension. */
export function draftExportFilename(
  title: string,
  versionNo: number,
  format: ExportFormat,
): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'draft'}-v${String(versionNo)}.${format}`;
}

async function findExport(
  db: Queryable,
  workspaceId: string,
  draftVersionId: string,
  format: ExportFormat,
): Promise<DraftExportRow | undefined> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(draftExport)
      .where(
        and(
          eq(draftExport.workspaceId, workspaceId),
          eq(draftExport.draftVersionId, draftVersionId),
          eq(draftExport.format, format),
        ),
      )
      .limit(1);
    return row;
  });
}

export async function runDraftingExport(
  ctx: DraftingExportCtx,
  payload: DraftingExportPayload,
): Promise<DraftingExportResult> {
  const { workspaceId, draftVersionId, format, userId } = payload;
  const now = ctx.now ?? (() => new Date());
  const fields = { workspaceId, draftVersionId, format };

  const stored = await findExport(ctx.db, workspaceId, draftVersionId, format);
  if (stored) {
    ctx.log.info(fields, 'draft export already stored');
    return { status: 'existing', export: stored };
  }

  const actor: DraftActor = { workspaceId, userId };
  const source = await asDraftMember(ctx.db, actor, async (tx, reader, settings) => {
    const [version] = await tx
      .select()
      .from(draftVersion)
      .where(and(eq(draftVersion.workspaceId, workspaceId), eq(draftVersion.id, draftVersionId)))
      .limit(1);
    if (version === undefined) throw notFound('Version not found');
    const row = await requireDraft(tx, reader, settings, version.draftId, 'draft.export');
    const [tpl] = await tx
      .select({ courtPreset: template.courtPreset })
      .from(template)
      .where(eq(template.id, row.templateId));
    // The job can be enqueued directly, so the citation gate holds here too.
    assertCitationsClear(
      await exportBlockedByCitations(
        tx,
        workspaceId,
        draftVersionId,
        checkBlocksFor(version.content),
      ),
    );
    return { version, draft: row, courtPreset: tpl?.courtPreset };
  });

  const preset: CourtFormatPreset | undefined = getPreset(source.courtPreset as CourtPreset);
  if (preset === undefined) throw invalid('No export format for this template yet');
  const blocks = checkBlocksFor(source.version.content);
  const facts = await loadDraftFacts({ db: ctx.db, now }, actor, source.draft.matterId);
  const narratives =
    collectNarratives(blocks).length === 0
      ? {}
      : await draftNarratives(
          ctx.narrativePort ?? createCoreAiGateway(ctx.db, { now }),
          blocks,
          facts,
          {
            workspaceId,
            userId,
            ...(source.draft.matterId ? { matterId: source.draft.matterId } : {}),
            idempotencyKey: `drafting.export:${draftVersionId}`,
          },
        );

  const render = format === 'docx' ? renderDocx : renderPdf;
  const bytes = await render(blocks, preset, facts, { narratives });

  const filename = draftExportFilename(source.draft.title, source.version.versionNo, format);
  const file = await storeSystemBlob(
    { db: ctx.db, store: ctx.store, keys: ctx.keys, workspaceId, now },
    { kind: 'export', filename, mime: EXPORT_MIME[format], bytes },
  );

  const outcome = await withWorkspace(ctx.db, { workspaceId, userId }, async (tx) => {
    const [inserted] = await tx
      .insert(draftExport)
      .values({
        workspaceId,
        draftVersionId,
        format,
        storageKey: file.key,
        sizeBytes: bytes.byteLength,
        contentSha256: source.version.contentSha256,
        exportedAt: now(),
        createdBy: userId,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted === undefined) return undefined;
    await record(
      { db: tx, workspaceId, actor: { userId, kind: 'user' } },
      {
        action: 'draft.exported',
        target: { kind: 'draft_version', id: draftVersionId },
        metadata: { format, versionHash: source.version.contentSha256 },
      },
    );
    return inserted;
  });
  if (outcome === undefined) {
    // A concurrent run stored it first: drop this copy and return theirs.
    await ctx.store.delete(file.key).catch(() => undefined);
    await withWorkspace(ctx.db, { workspaceId }, (tx) =>
      tx.delete(blob).where(and(eq(blob.workspaceId, workspaceId), eq(blob.id, file.blobId))),
    );
    const winner = await findExport(ctx.db, workspaceId, draftVersionId, format);
    if (winner === undefined) throw new Error('draft export vanished after a conflict');
    return { status: 'existing', export: winner };
  }
  ctx.log.info({ ...fields, sizeBytes: bytes.byteLength }, 'draft exported');
  return { status: 'exported', export: outcome };
}

export interface DraftExportDownloadCtx {
  db: Database | Transaction;
  store: ObjectStore;
  now?: () => Date;
}

/**
 * A 60-second presigned GET for a stored export, after the matter and `draft.export` checks on the
 * draft it belongs to (NOT_FOUND for another workspace's export). Presigned download is the only way
 * out: nothing here emails or shares the file.
 */
export async function createDraftExportDownload(
  ctx: DraftExportDownloadCtx,
  actor: DraftActor,
  exportId: string,
): Promise<DownloadUrl & { filename: string }> {
  const found = await asDraftMember(ctx.db, actor, async (tx, reader, settings) => {
    const [row] = await tx
      .select({
        storageKey: draftExport.storageKey,
        draftId: draftVersion.draftId,
      })
      .from(draftExport)
      .innerJoin(
        draftVersion,
        and(
          eq(draftVersion.workspaceId, draftExport.workspaceId),
          eq(draftVersion.id, draftExport.draftVersionId),
        ),
      )
      .where(and(eq(draftExport.workspaceId, reader.workspaceId), eq(draftExport.id, exportId)))
      .limit(1);
    if (row === undefined) throw notFound('Export not found');
    await requireDraft(tx, reader, settings, row.draftId, 'draft.export');
    const [file] = await tx
      .select({ id: blob.id, filename: blob.filename })
      .from(blob)
      .where(
        and(eq(blob.workspaceId, reader.workspaceId), eq(blob.key, row.storageKey as ObjectKey)),
      )
      .limit(1);
    if (file === undefined) throw notFound('Export not found');
    return file;
  });
  const url = await createDownloadUrl(
    {
      db: ctx.db,
      store: ctx.store,
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      // The draft and `draft.export` checks above are this download's authorization.
      authorize: () => undefined,
      ...(ctx.now ? { now: ctx.now } : {}),
    },
    found.id,
  );
  return { ...url, filename: found.filename };
}
