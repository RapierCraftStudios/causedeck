// `/api/activity/export` (#49): the automation activity log of one workspace as CSV or JSON for a
// date range: input source, model and version, region, confidence, level, who confirmed, time and
// undo state. `GET ?workspaceId&from&to&format=csv|json` checks session and membership (and the
// owner 2FA policy, an export is destructive, #290); core decides who may export what (owners the
// workspace, everyone else their own activity) and records `audit.exported` before returning rows.
// 401 signed out, 403 forbidden, 404 not a member, 400 bad input.
import type { ActivityExportRow } from '@causedeck/core/automation';
import { exportActivitiesFor } from '@causedeck/core/runtime';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { z } from 'zod';

import { getSession } from '../../../../lib/auth.ts';
import { guard, guardResponse } from '../../../../lib/guard.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const query = z
  .object({
    workspaceId: z.uuid(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    format: z.enum(['csv', 'json']),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), { path: ['to'] });

const COLUMNS: (keyof ActivityExportRow)[] = [
  'id',
  'created_at',
  'kind',
  'level',
  'actor',
  'actor_user_id',
  'summary',
  'input_source',
  'model',
  'model_version',
  'region',
  'confidence',
  'confirmed_by',
  'confirmed_at',
  'undo_payload',
  'undo_expires_at',
  'undone_at',
  'undone_by',
  'parent_activity_id',
  'cascade_group_id',
  'capture_id',
];

const json = (status: number, body: object) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// A cell a spreadsheet would read as a formula gets a leading quote (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const text = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: readonly ActivityExportRow[]): string {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) lines.push(COLUMNS.map((column) => cell(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const url = new URL(request.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json(400, { error: 'invalid' });
  const { workspaceId, from, to, format } = parsed.data;
  try {
    const { userId } = await guard({ workspaceId, session, destructive: true });
    const rows = await exportActivitiesFor(
      { workspaceId, userId },
      { from: new Date(from), to: new Date(to), limit: 1000 },
    );
    const name = `activity-${from.slice(0, 10)}-${to.slice(0, 10)}.${format}`;
    return new Response(format === 'csv' ? toCsv(rows) : JSON.stringify(rows, null, 2), {
      status: 200,
      headers: {
        'Content-Type':
          format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const response = guardResponse(error);
    if (response) return response;
    if (error instanceof WorkspaceError) {
      if (error.code === 'NOT_FOUND') return json(404, { error: 'not_found' });
      if (error.code === 'FORBIDDEN') return json(403, { error: 'forbidden' });
      if (error.code === 'VALIDATION') return json(400, { error: 'invalid' });
    }
    throw error;
  }
}
