// Support sessions (#314, part of #27; spike §6): the signed-in staff member's own sessions in
// every workspace, newest first, and the request form. A session is a consented, time-boxed,
// read-only window into one workspace; only its owner can grant it (Settings, Support access).
import { listStaffSupportSessionsFor } from '@causedeck/core/runtime';
import { SUPPORT_REASON_MAX_LENGTH, supportSessionState } from '@causedeck/core/support';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@causedeck/ui/table';
import type { Metadata } from 'next';
import Link from 'next/link';

import { dateTime } from '../../../components/support/format.ts';
import { RequestForm } from '../../../components/support/request-form.tsx';
import { SessionStateChip } from '../../../components/support/session-state-chip.tsx';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Support sessions' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff('support');
  const { workspace } = await searchParams;
  const prefill = typeof workspace === 'string' && UUID.test(workspace) ? workspace : '';
  const sessions = await listStaffSupportSessionsFor(staff.userId);
  const now = new Date();
  return (
    <section aria-labelledby="page-title" className="grid gap-6">
      <h1 id="page-title" className="text-lg font-semibold">
        Support sessions
      </h1>
      {sessions.length === 0 ? (
        <EmptyState
          title="No support sessions."
          description="Request one below. The workspace owner decides, and can end it at any time."
        />
      ) : (
        <Table aria-label="Your support sessions" data-slot="support-sessions">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Ends</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id} data-slot="support-session-row" data-session-id={s.id}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/support/${s.id}`} className="underline-offset-2 hover:underline">
                    {s.workspaceId}
                  </Link>
                </TableCell>
                <TableCell>{s.scope === 'view' ? 'Read-only view' : 'Metadata'}</TableCell>
                <TableCell>
                  <SessionStateChip state={supportSessionState(s, now)} />
                </TableCell>
                <TableCell className="max-w-72 truncate">{s.reason}</TableCell>
                <TableCell>{dateTime(s.createdAt)}</TableCell>
                <TableCell>{dateTime(s.expiresAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <RequestForm workspaceId={prefill} reasonMaxLength={SUPPORT_REASON_MAX_LENGTH} />
    </section>
  );
}
