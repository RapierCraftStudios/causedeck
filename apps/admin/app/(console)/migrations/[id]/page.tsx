// One migration run (#685): progress, the dry-run report (issue codes and row numbers, never row
// content) and the resume and rollback controls.
import { Button } from '@causedeck/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { migrationRunProgress, migrationRunReport } from '../../../../lib/data/index.ts';
import { requireStaff } from '../../../../lib/staff.ts';
import { resumeRunAction, rollbackRunAction } from '../actions.ts';

export const metadata: Metadata = { title: 'Migration run' };

const MAX_LISTED_ISSUES = 200;

export default async function MigrationRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff('migrations');
  const { id } = await params;
  const query = await searchParams;
  const workspace = z.uuid().safeParse(typeof query.workspace === 'string' ? query.workspace : '');
  if (!workspace.success) notFound();
  const workspaceId = workspace.data.toLowerCase();
  const progress = await migrationRunProgress(staff, workspaceId, id);
  if (progress === null) notFound();
  const report = await migrationRunReport(staff, workspaceId, id);
  const error = typeof query.error === 'string' ? query.error : undefined;
  const canResume =
    progress.mode === 'import' && (progress.status === 'queued' || progress.status === 'running');
  const canRollback =
    progress.mode === 'import' && progress.rolledBackAt === null && progress.chunks.done > 0;
  const hidden = (
    <>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="runId" value={progress.runId} />
    </>
  );
  return (
    <section aria-labelledby="page-title" className="grid gap-6">
      <p className="text-sm">
        <Link href={`/migrations?workspace=${workspaceId}`} className="underline">
          Migrations
        </Link>
      </p>
      <h1 id="page-title" className="text-lg font-semibold">
        {`Migration run ${progress.runId.slice(0, 8)}`}
      </h1>
      {error === undefined ? null : (
        <p role="alert" className="text-sm">{`The last action failed (${error}).`}</p>
      )}
      <dl className="grid max-w-md grid-cols-2 gap-1 text-sm">
        <dt>Mode</dt>
        <dd>{progress.mode}</dd>
        <dt>Status</dt>
        <dd>{progress.status}</dd>
        <dt>Rows processed</dt>
        <dd>{`${String(progress.processedRows)} / ${String(progress.totalRows)}`}</dd>
        <dt>Rows with errors</dt>
        <dd>{progress.errorRows}</dd>
        <dt>Chunks done</dt>
        <dd>{`${String(progress.chunks.done)} / ${String(progress.chunks.total)}`}</dd>
      </dl>
      <div className="flex gap-2">
        {canResume ? (
          <form action={resumeRunAction}>
            {hidden}
            <Button type="submit">Resume import</Button>
          </form>
        ) : null}
        {canRollback ? (
          <form action={rollbackRunAction}>
            {hidden}
            <Button type="submit" variant="outline">
              Roll back
            </Button>
          </form>
        ) : null}
      </div>
      {report === null ? null : (
        <div className="grid gap-2 text-sm">
          <h2 className="font-medium">Mapping issues</h2>
          {report.missingColumns.length > 0 ? (
            <p>{`Columns not found in the file: ${report.missingColumns.join(', ')}`}</p>
          ) : null}
          {Object.keys(report.issueCounts).length === 0 ? (
            <p>No mapping issues.</p>
          ) : (
            <ul>
              {Object.entries(report.issueCounts).map(([code, count]) => (
                <li key={code}>{`${code}: ${String(count)}`}</li>
              ))}
            </ul>
          )}
          {report.issues.length > 0 ? (
            <ul aria-label="Rows with issues">
              {report.issues.slice(0, MAX_LISTED_ISSUES).map((issue) => (
                <li
                  key={`${String(issue.row)}-${issue.code}`}
                >{`Row ${String(issue.row)}: ${issue.code}`}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
