'use server';
// The fixture workbench's actions (#516, D-048). Each re-checks the staff member and the `adapters`
// capability (ops and admin) and records `staff.read` (actor kind `staff`) before it touches the
// document. The contributed document lives only in the request: it is never stored or logged. The
// build action returns the redacted bundle alone (`@causedeck/adapters/workbench` refuses to build
// one that still holds a known party name or personal data); the preview returns the parser's
// output so the labeler can correct it, to the staff member who supplied the document.
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
import { z } from 'zod';

import { requireStaff, type StaffMember } from '../../../lib/staff.ts';

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

/** The document: an uploaded file when one was chosen, else the pasted text. */
async function documentOf(formData: FormData): Promise<string> {
  const file = formData.get('file');
  const content =
    file instanceof File && file.size > 0 ? await file.text() : text(formData, 'document');
  if (content.trim() === '') throw new WorkbenchError('Add a document to label.');
  if (content.length > MAX_DOCUMENT_CHARS) throw new WorkbenchError('That document is too large.');
  return content;
}

async function audit(staff: StaffMember, step: 'preview' | 'build', adapterId: string) {
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
  const document = await documentOf(formData);
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
      corrections: correctionsFromEdits(parsed, { listDate: text(formData, 'listDate'), rows: edits }),
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
