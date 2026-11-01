'use server';
// The fixture workbench's actions (#516, D-048). Each re-checks the staff member and the `adapters`
// capability (ops and admin) and records `staff.read` (actor kind `staff`) before it touches the
// document. The contributed document lives only in the request: it is never stored or logged. The
// build action returns the redacted bundle alone (`@causedeck/adapters/workbench` refuses to build
// one that still holds a known party name or personal data); the preview returns the parser's
// output so the labeler can correct it, to the staff member who supplied the document.
// The document comes from an upload, pasted text or, while `adapters.workbench-fetch` is on, a
// governed one-off fetch of a registered source URL (#598): audited as step `fetch`, body held in
// memory only (`fetch_log` stays body-free), mock provider until the AlterLab key is set.
import {
  buildFixture,
  correctionsFromEdits,
  EDITABLE_ROW_FIELDS,
  previewDocument,
  WORKBENCH_ADAPTERS,
  WORKBENCH_FORMATS,
  WorkbenchError,
  type FixtureBundle,
  type WorkbenchFormat,
} from '@causedeck/adapters/workbench';
import { record } from '@causedeck/core/audit';
import { db } from '@causedeck/core/runtime';
import { SourceNotCleared } from '@causedeck/core/sources';
import { FetchDenied, FetchError } from '@causedeck/fetch';
import { z } from 'zod';

import { requireStaff, type StaffMember } from '../../../lib/staff.ts';
import { workbenchFetcher, workbenchFetchEnabled } from '../../../lib/workbench-fetcher.ts';

export interface FixtureRowView {
  /** The row as the parser printed it, for the labeler's reference. */
  quote: string;
  cells: Record<string, string>;
}

export interface WorkbenchState {
  error?: string;
  preview?: {
    adapterId: string;
    format: WorkbenchFormat;
    name: string;
    document: string;
    extraNames: string;
    listDate: string;
    rows: FixtureRowView[];
  };
  built?: {
    bundle: FixtureBundle;
    redactions: { names: number; pii: number };
    reparseMatches: boolean;
  };
}

const MAX_DOCUMENT_CHARS = 1_000_000;

const inputSchema = z.object({
  adapterId: z.string().refine((id) => id in WORKBENCH_ADAPTERS, 'Unknown adapter'),
  format: z.enum(WORKBENCH_FORMATS),
  name: z.string().trim().min(1).max(100),
  extraNames: z.string().max(5000).default(''),
});

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

/**
 * A one-off governed fetch of `fetchUrl` on the registered source `fetchSourceId`. The body is
 * returned to the request and nowhere else; a refusal becomes a message, never the body.
 */
async function fetchedDocument(
  staff: StaffMember,
  adapterId: string,
  sourceId: string,
  url: string,
): Promise<string> {
  if (!(await workbenchFetchEnabled(db, staff.userId))) {
    throw new WorkbenchError('Fetching a document is not enabled.');
  }
  // Audited before the call, so a fetch that fails still leaves its trace.
  await audit(staff, 'fetch', adapterId, { sourceId });
  try {
    const result = await workbenchFetcher(db).fetchSource(sourceId, url);
    if (result.status < 200 || result.status >= 300) {
      throw new WorkbenchError(`The source answered ${String(result.status)}.`);
    }
    return result.body;
  } catch (error) {
    if (error instanceof SourceNotCleared) {
      throw new WorkbenchError('That source is not cleared for fetching.');
    }
    if (error instanceof FetchDenied) throw new WorkbenchError(`Fetch refused: ${error.reason}.`);
    if (error instanceof FetchError) throw new WorkbenchError('The fetch failed.');
    throw error;
  }
}

/** The document: an uploaded file, else the pasted text, else a governed fetch. */
async function documentOf(
  formData: FormData,
  staff: StaffMember,
  adapterId: string,
): Promise<string> {
  const file = formData.get('file');
  let content =
    file instanceof File && file.size > 0 ? await file.text() : text(formData, 'document');
  const fetchUrl = text(formData, 'fetchUrl').trim();
  if (content.trim() === '' && fetchUrl !== '') {
    content = await fetchedDocument(
      staff,
      adapterId,
      text(formData, 'fetchSourceId').trim(),
      fetchUrl,
    );
  }
  if (content.trim() === '') throw new WorkbenchError('Add a document to label.');
  if (content.length > MAX_DOCUMENT_CHARS) throw new WorkbenchError('That document is too large.');
  return content;
}

async function audit(
  staff: StaffMember,
  step: 'preview' | 'build' | 'fetch',
  adapterId: string,
  extra: { sourceId?: string } = {},
) {
  await record(
    {
      db,
      workspaceId: null,
      actor: { userId: staff.userId, kind: 'staff' },
      ...(staff.ip === undefined ? {} : { ip: staff.ip }),
      ...(staff.userAgent === undefined ? {} : { userAgent: staff.userAgent }),
      ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
    },
    {
      action: 'staff.read',
      metadata: {
        purpose: 'adapters.fixture_workbench',
        capability: 'adapters',
        step,
        adapterId,
        ...extra,
        role: staff.role,
      },
    },
  );
}

async function load(staff: StaffMember, step: 'preview' | 'build', formData: FormData) {
  const input = inputSchema.parse({
    adapterId: text(formData, 'adapterId'),
    format: text(formData, 'format'),
    name: text(formData, 'name'),
    extraNames: text(formData, 'extraNames'),
  });
  await audit(staff, step, input.adapterId);
  const adapter = WORKBENCH_ADAPTERS[input.adapterId]?.();
  if (adapter === undefined) throw new WorkbenchError('Unknown adapter');
  const document = await documentOf(formData, staff, input.adapterId);
  return { input, adapter, document };
}

function failure(error: unknown): WorkbenchState {
  if (error instanceof WorkbenchError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: 'Check the fields and try again.' };
  throw error;
}

/** Run the adapter on the document and return its rows for correction. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('adapters')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function previewFixtureAction(
  _previous: WorkbenchState,
  formData: FormData,
): Promise<WorkbenchState> {
  const staff = await requireStaff('adapters');
  try {
    const { input, adapter, document } = await load(staff, 'preview', formData);
    const parsed = await previewDocument(adapter, input.format, document);
    return {
      preview: {
        ...input,
        document,
        listDate: parsed.listDate ?? '',
        rows: parsed.rows.map((row) => ({
          quote: row.anchor.quote,
          cells: Object.fromEntries(
            EDITABLE_ROW_FIELDS.map((field) => [field, String(row[field] ?? '')]),
          ),
        })),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

/** Apply the labeler's corrections, redact, and return the fixture bundle. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('adapters')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function buildFixtureAction(
  _previous: WorkbenchState,
  formData: FormData,
): Promise<WorkbenchState> {
  const staff = await requireStaff('adapters');
  try {
    const { input, adapter, document } = await load(staff, 'build', formData);
    const parsed = await previewDocument(adapter, input.format, document);
    const edits = parsed.rows.map((_row, index) =>
      Object.fromEntries(
        EDITABLE_ROW_FIELDS.flatMap((field) => {
          const key = `row.${String(index)}.${field}`;
          return formData.has(key) ? [[field, text(formData, key)]] : [];
        }),
      ),
    );
    const built = await buildFixture({
      adapter,
      name: input.name,
      format: input.format,
      content: document,
      corrections: correctionsFromEdits(parsed, {
        listDate: text(formData, 'listDate'),
        rows: edits,
      }),
      extraNames: input.extraNames
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    });
    return { built };
  } catch (error) {
    return failure(error);
  }
}
