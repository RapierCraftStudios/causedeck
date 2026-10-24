// One review item (#518): the record under review (the view is audited), assignment, the fix form
// and, once fixed, send-to-workbench.
import { WORKBENCH_ADAPTERS } from '@causedeck/adapters/workbench';
import { getReviewItem } from '@causedeck/core/review';
import { db } from '@causedeck/core/runtime';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { REVIEW_FIELDS } from '@causedeck/db/schema';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReviewFixtureForm } from '../../../../components/review-fixture-form.tsx';
import { requireStaff } from '../../../../lib/staff.ts';
import { assignReviewAction, dismissReviewAction, submitFixAction } from '../actions.ts';

export const metadata: Metadata = { title: 'Review item' };

const closed = (status: string) => status === 'fixed' || status === 'dismissed';

export default async function ReviewItemPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff('data-ops');
  const { id } = await params;
  const item = await getReviewItem(db, staff, id).catch((error: unknown) => {
    if (error instanceof WorkspaceError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          {item.kind.replace('_', ' ')} on {item.sourceId}
        </h1>
        <p className="text-ink-muted text-sm">
          {item.status}, due {item.dueAt.toISOString().slice(0, 16).replace('T', ' ')}.{' '}
          <Link href="/review" className="underline">
            Queue
          </Link>
        </p>
      </div>
      <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt>Case</dt>
        <dd>{item.cnr ?? '-'}</dd>
        <dt>Field</dt>
        <dd>{item.field ?? '-'}</dd>
        <dt>Shown</dt>
        <dd>{item.shownValue ?? '-'}</dd>
        <dt>Reported</dt>
        <dd>{item.reportedValue ?? '-'}</dd>
        <dt>Signal</dt>
        <dd>{item.detail ?? '-'}</dd>
        <dt>Assignee</dt>
        <dd>{item.assigneeId ?? 'Unassigned'}</dd>
        {item.correctedValue === null ? null : (
          <>
            <dt>Fix</dt>
            <dd>{item.correctedValue}</dd>
          </>
        )}
      </dl>
      {closed(item.status) ? null : (
        <div className="grid max-w-xl gap-4">
          <div className="flex gap-2">
            <form action={assignReviewAction}>
              <input type="hidden" name="id" value={item.id} />
              <Button type="submit">Take it</Button>
            </form>
            {item.assigneeId === null ? null : (
              <form action={assignReviewAction}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="release" value="1" />
                <Button type="submit" variant="secondary">
                  Release
                </Button>
              </form>
            )}
            <form action={dismissReviewAction}>
              <input type="hidden" name="id" value={item.id} />
              <Button type="submit" variant="secondary">
                Dismiss
              </Button>
            </form>
          </div>
          <form action={submitFixAction} className="grid gap-3">
            <input type="hidden" name="id" value={item.id} />
            {item.cnr === null ? (
              <div className="grid gap-1">
                <Label htmlFor="cnr">Case number (CNR)</Label>
                <Input id="cnr" name="cnr" required />
              </div>
            ) : null}
            {item.field === null ? (
              <div className="grid gap-1">
                <Label htmlFor="field">Field</Label>
                <select id="field" name="field" className="border-line rounded border p-2 text-sm">
                  {REVIEW_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-1">
              <Label htmlFor="correctedValue">Corrected value</Label>
              <Input
                id="correctedValue"
                name="correctedValue"
                required
                maxLength={200}
                defaultValue={item.reportedValue ?? ''}
              />
            </div>
            <Button type="submit">Submit fix</Button>
          </form>
        </div>
      )}
      {item.status === 'fixed' ? (
        <div className="grid gap-2">
          <h2 className="font-semibold">Regression fixture</h2>
          {item.fixtureExportedAt === null ? null : (
            <p className="text-ink-muted text-sm">
              Sent {item.fixtureExportedAt.toISOString().slice(0, 16).replace('T', ' ')}.
            </p>
          )}
          <ReviewFixtureForm id={item.id} adapterIds={Object.keys(WORKBENCH_ADAPTERS).sort()} />
        </div>
      ) : null}
    </section>
  );
}
