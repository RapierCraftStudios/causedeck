// Limitation rules (#942, part of #84): import a counsel rule table for a workspace and see each
// rule's review status. ops and admin only (`requireStaff('limitation-rules')`); every read and the
// import are audited. An imported table is always an unreviewed draft: a draft is listed but never
// used to compute a date until counsel signs it off (#120). Shows codes and periods only.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import type { Metadata } from 'next';
import { z } from 'zod';

import { workspaceLimitationRules, type RuleView } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

import { importRuleTableAction } from './actions.ts';

export const metadata: Metadata = { title: 'Limitation rules' };

const ERRORS: Record<string, string> = {
  workspace: 'Enter a workspace id.',
  table: 'Paste a rule table of at most 200,000 characters.',
  json: 'The rule table is not valid JSON.',
  no_owner: 'This workspace has no active owner to import as.',
  disabled: 'The limitation tracker is not enabled for this workspace.',
  validation: 'The rule table is not valid. Check the version, codes, periods and start events.',
  forbidden: 'Only the workspace owner can import a rule table.',
};

function doneMessage(done: string): string {
  const [version = '', imported = '0', skipped = '0'] = done.split(':');
  return `Imported table ${version} as draft: ${imported} rules added, ${skipped} already present. Drafts are not used until counsel reviews them.`;
}

export default async function LimitationRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff('limitation-rules');
  const params = await searchParams;
  const workspace = z
    .uuid()
    .safeParse(typeof params.workspace === 'string' ? params.workspace.trim() : '');
  const workspaceId = workspace.success ? workspace.data.toLowerCase() : undefined;
  const done = typeof params.done === 'string' ? params.done : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;
  let rules: RuleView[] | null = null;
  let unavailable = false;
  if (workspaceId !== undefined) {
    try {
      rules = await workspaceLimitationRules(staff, workspaceId);
    } catch {
      unavailable = true;
    }
  }

  return (
    <section aria-labelledby="page-title" className="grid gap-6">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Limitation rules
        </h1>
        <p className="text-ink-muted max-w-prose text-sm">
          Import a counsel rule table for a workspace. An imported table is a draft: it is never
          used to compute a date until counsel has reviewed it.
        </p>
      </div>
      {done === undefined ? null : <p role="status">{doneMessage(done)}</p>}
      {error === undefined ? null : (
        <p role="alert">{ERRORS[error] ?? 'The rule table could not be imported.'}</p>
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
          <form action={importRuleTableAction} className="grid max-w-xl gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <div className="grid gap-1">
              <Label htmlFor="table">Rule table (JSON)</Label>
              <textarea
                id="table"
                name="table"
                rows={10}
                className="border-line bg-surface rounded border px-2 py-1 font-mono text-sm"
              />
            </div>
            <div>
              <Button type="submit">Import as draft</Button>
            </div>
          </form>
          {unavailable ? (
            <p role="alert">The limitation tracker is not enabled for this workspace.</p>
          ) : rules === null ? (
            <p role="alert">{ERRORS.no_owner}</p>
          ) : (
            <table className="text-sm">
              <caption className="text-left font-medium">Rules</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Title</th>
                  <th scope="col">Period</th>
                  <th scope="col">Table version</th>
                  <th scope="col">Review status</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{r.title}</td>
                    <td>{`${String(r.periodValue)} ${r.periodUnit}`}</td>
                    <td>{r.tableVersion}</td>
                    <td>{r.draft ? 'Draft (unreviewed)' : 'Reviewed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
