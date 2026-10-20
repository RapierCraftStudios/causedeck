// Flags (#311): global flags, one workspace's overrides and pending legal-gated requests. ops and
// admin only (`requireStaff('flags')`); every read is audited (lib/flags.ts) and every change goes
// through actions.ts. Workspaces are picked by id until the staff workspace lookup (#310) lands.
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@causedeck/ui/table';
import type { Metadata } from 'next';
import { z } from 'zod';

import { adminEnv } from '../../../lib/env.ts';
import { flagRowsView, pendingRequestsView, type FlagRowView } from '../../../lib/flags.ts';
import { DEV_STAFF_EMAIL } from '../../../lib/roles.ts';
import { requireStaff } from '../../../lib/staff.ts';
import { FlagRow, PendingRequestRow } from './flag-row.tsx';

export const metadata: Metadata = { title: 'Flags' };

function FlagTable({
  label,
  flags,
  workspaceId,
  totpRequired,
}: {
  label: string;
  flags: FlagRowView[];
  workspaceId?: string;
  totpRequired: boolean;
}) {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>Flag</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>{workspaceId === undefined ? 'Global row' : 'Override'}</TableHead>
          <TableHead>Effective</TableHead>
          <TableHead>Change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {flags.map((flag) => (
          <FlagRow
            key={flag.key}
            flag={flag}
            workspaceId={workspaceId}
            totpRequired={totpRequired}
          />
        ))}
      </TableBody>
    </Table>
  );
}

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff('flags');
  const env = adminEnv();
  const totpRequired = !(
    env.NODE_ENV !== 'production' && staff.email.toLowerCase() === DEV_STAFF_EMAIL
  );
  const raw = (await searchParams).workspace;
  const workspaceParam = typeof raw === 'string' ? raw.trim() : '';
  const workspace = z.uuid().safeParse(workspaceParam);
  const workspaceId = workspace.success ? workspace.data.toLowerCase() : undefined;

  const [globalFlags, pending] = [await flagRowsView(staff), await pendingRequestsView(staff)];
  const overrides = workspaceId === undefined ? null : await flagRowsView(staff, workspaceId);

  return (
    <section aria-labelledby="page-title" className="grid gap-8">
      <h1 id="page-title" className="text-lg font-semibold">
        Flags
      </h1>

      <section aria-labelledby="global-title" className="grid gap-3">
        <h2 id="global-title" className="text-base font-semibold">
          Global flags
        </h2>
        <FlagTable label="Global flags" flags={globalFlags} totpRequired={totpRequired} />
      </section>

      <section aria-labelledby="pending-title" className="grid gap-3">
        <h2 id="pending-title" className="text-base font-semibold">
          Pending approvals
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            title="No pending approvals."
            description="Requests to enable a legal-gated flag wait here for a second admin."
          />
        ) : (
          <Table aria-label="Pending approvals">
            <TableHeader>
              <TableRow>
                <TableHead>Flag</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Legal note</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((request) => (
                <PendingRequestRow
                  key={request.id}
                  request={request}
                  admin={staff.role === 'admin'}
                  totpRequired={totpRequired}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="workspace-title" className="grid gap-3">
        <h2 id="workspace-title" className="text-base font-semibold">
          Workspace overrides
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="workspace">Workspace id</Label>
            <Input
              id="workspace"
              name="workspace"
              defaultValue={workspaceParam}
              className="w-96 max-w-full font-mono"
              aria-describedby="workspace-error"
              aria-invalid={workspaceParam !== '' && workspaceId === undefined}
            />
          </div>
          <Button type="submit" variant="secondary">
            Show overrides
          </Button>
        </form>
        <p id="workspace-error" role="status" className="text-danger min-h-5 text-sm">
          {workspaceParam !== '' && workspaceId === undefined
            ? 'Enter a workspace id (a UUID).'
            : null}
        </p>
        {overrides !== null && workspaceId !== undefined ? (
          <FlagTable
            label={`Overrides for workspace ${workspaceId}`}
            flags={overrides}
            workspaceId={workspaceId}
            totpRequired={totpRequired}
          />
        ) : null}
      </section>
    </section>
  );
}
