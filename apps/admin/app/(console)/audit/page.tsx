import { EmptyState } from '@causedeck/ui/empty-state';
import type { Metadata } from 'next';
import Link from 'next/link';

import { staffAuditLog, type StaffAuditCursor } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Audit' };

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SearchParams {
  before?: string | string[];
  id?: string | string[];
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The `?before=<iso>&id=<uuid>` cursor, or none when absent or malformed. */
function cursorOf(params: SearchParams): StaffAuditCursor | undefined {
  const before = first(params.before);
  const id = first(params.id);
  if (before === undefined || id === undefined || !UUID.test(id)) return undefined;
  const createdAt = new Date(before);
  return Number.isNaN(createdAt.getTime()) ? undefined : { createdAt, id };
}

/** The platform staff audit (#310): staff id, action, workspace and session id; no content. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff('audit');
  const entries = await staffAuditLog(staff, cursorOf(await searchParams));
  const last = entries.at(-1);
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <h1 id="page-title" className="text-lg font-semibold">
        Audit
      </h1>
      {entries.length === 0 ? (
        <EmptyState title="No staff actions." description="Staff actions appear here." />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 font-medium">Time (UTC)</th>
              <th className="py-1 font-medium">Staff id</th>
              <th className="py-1 font-medium">Action</th>
              <th className="py-1 font-medium">Workspace</th>
              <th className="py-1 font-medium">Session id</th>
              <th className="py-1 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {entries.map((e) => (
              <tr key={e.id} className="border-line border-t">
                <td className="py-1 tabular-nums">
                  {e.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="py-1">{e.staffUserId ?? '—'}</td>
                <td className="py-1">{e.action}</td>
                <td className="py-1">
                  {e.workspaceId === null ? (
                    '—'
                  ) : (
                    <Link href={`/workspaces/${e.workspaceId}`} className="underline">
                      {e.workspaceId}
                    </Link>
                  )}
                </td>
                <td className="py-1">{e.sessionId ?? '—'}</td>
                <td className="py-1">{e.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {last !== undefined && entries.length === PAGE_SIZE ? (
        <p className="text-sm">
          <Link
            href={`/audit?before=${encodeURIComponent(last.createdAt.toISOString())}&id=${last.id}`}
            className="underline"
          >
            Older
          </Link>
        </p>
      ) : null}
    </section>
  );
}
