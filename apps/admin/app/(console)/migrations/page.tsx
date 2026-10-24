// Migrations (#685, part of #508): pick a workspace, upload its portfolio CSV, map the columns, dry
// run, then import. Shows each run's counts and states only: no matter content. ops and admin only.
import { MIGRATION_FIELDS } from '@causedeck/core/migration';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { workspaceMigrationRuns } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

import { startDryRunAction, startImportAction } from './actions.ts';

export const metadata: Metadata = { title: 'Migrations' };

const ERRORS: Record<string, string> = {
  file: 'Choose a CSV file of at most 5 MB.',
  no_owner: 'This workspace has no active owner to run the migration as.',
  validation: 'The file is empty or has more than 5,000 rows.',
  forbidden: 'Only the workspace owner can run a migration.',
};

export default async function MigrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff('migrations');
  const params = await searchParams;
  const workspace = z
    .uuid()
    .safeParse(typeof params.workspace === 'string' ? params.workspace.trim() : '');
  const workspaceId = workspace.success ? workspace.data.toLowerCase() : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;
  const runs = workspaceId === undefined ? [] : await workspaceMigrationRuns(staff, workspaceId);

  return (
    <section aria-labelledby="page-title" className="grid gap-8">
      <h1 id="page-title" className="text-lg font-semibold">
        Migrations
      </h1>
      {error === undefined ? null : (
        <p role="alert" className="text-sm">
          {ERRORS[error] ?? 'The migration could not be started.'}
        </p>
      )}
      <form method="get" className="flex items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="workspace">Workspace id</Label>
          <Input id="workspace" name="workspace" defaultValue={workspaceId ?? ''} />
        </div>
        <Button type="submit">Open</Button>
      </form>
      {workspaceId === undefined ? null : (
        <>
          <form className="grid max-w-xl gap-3" encType="multipart/form-data">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <div className="grid gap-1">
              <Label htmlFor="file">Portfolio CSV (up to 5,000 rows)</Label>
              <Input id="file" name="file" type="file" accept=".csv,text/csv" />
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">CSV column for each field</legend>
              {MIGRATION_FIELDS.map((field) => (
                <div key={field} className="grid gap-1">
                  <Label htmlFor={`map_${field}`}>{field}</Label>
                  <Input id={`map_${field}`} name={`map_${field}`} />
                </div>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" formAction={startDryRunAction}>
                Dry run
              </Button>
              <Button type="submit" variant="outline" formAction={startImportAction}>
                Start import
              </Button>
            </div>
          </form>
          <table className="text-sm">
            <caption className="text-left font-medium">Runs</caption>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Mode</th>
                <th scope="col">Status</th>
                <th scope="col">Rows</th>
                <th scope="col">Errors</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td>
                    <Link
                      href={`/migrations/${run.runId}?workspace=${workspaceId}`}
                      className="underline"
                    >
                      {run.runId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{run.mode}</td>
                  <td>{run.status}</td>
                  <td>{`${String(run.processedRows)} / ${String(run.totalRows)}`}</td>
                  <td>{run.errorRows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
