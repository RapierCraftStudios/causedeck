// One support session (#314, part of #27; spike §6). Pending: waiting for the owner, with
// `Withdraw request`. Active: a banner with the live countdown and `End session`; for a `view`
// session, the workspace as its members see it in settings (profile and members), every read
// going through the read-only support context and audited as `support.view`, under the fixed
// `SUPPORT SESSION: READ-ONLY` bar. Denied, expired and ended sessions show their state only: a
// grant is never extended, more time needs a new request. Someone else's session, an unknown id or
// a malformed one is the generic 404.
import { staffSupportSessionFor, supportWorkspaceViewFor } from '@causedeck/core/runtime';
import {
  SupportSessionInactiveError,
  supportSessionState,
  type SupportSession,
  type SupportWorkspaceView,
} from '@causedeck/core/support';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { Badge } from '@causedeck/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EndSessionButton } from '../../../../components/support/end-session-button.tsx';
import { dateTime } from '../../../../components/support/format.ts';
import { ReadOnlyBar } from '../../../../components/support/read-only-bar.tsx';
import { SessionCountdown } from '../../../../components/support/session-countdown.tsx';
import { SessionStateChip } from '../../../../components/support/session-state-chip.tsx';
import { requireStaff, type StaffMember } from '../../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Support session' };

const STATE_NOTE = {
  requested: 'Waiting for the workspace owner to grant or deny this request.',
  denied: 'The workspace owner denied this request. Ask again with a new request if needed.',
  expired: 'This session has run out. More time needs a new request and a new grant.',
  ended: 'This session has ended. Seeing the workspace again needs a new request and grant.',
} as const;

/** The read-only view, or `null` when the session stopped being active since it was loaded. */
async function loadView(
  staff: StaffMember,
  session: SupportSession,
): Promise<SupportWorkspaceView | null> {
  try {
    return await supportWorkspaceViewFor(
      {
        staffUserId: staff.userId,
        ...(staff.ip === undefined ? {} : { ip: staff.ip }),
        ...(staff.userAgent === undefined ? {} : { userAgent: staff.userAgent }),
        ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
      },
      session.workspaceId,
    );
  } catch (error) {
    if (error instanceof SupportSessionInactiveError) return null;
    if (error instanceof WorkspaceError && error.code === 'FORBIDDEN') return null;
    throw error;
  }
}

export default async function SupportSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff('support');
  const { id } = await params;
  const session = await staffSupportSessionFor(staff.userId, id);
  if (session === null) notFound();

  let state = supportSessionState(session);
  const view =
    state === 'active' && session.scope === 'view' ? await loadView(staff, session) : null;
  // Revoked or run out between loading the row and reading the view.
  if (state === 'active' && session.scope === 'view' && view === null) state = 'ended';
  const expiresAt = session.expiresAt?.toISOString() ?? null;

  return (
    <section
      aria-labelledby="page-title"
      data-slot="support-session"
      data-session-id={session.id}
      data-state={state}
      className={view === null ? 'grid gap-4' : 'grid gap-4 pt-10'}
    >
      {view !== null && expiresAt !== null ? (
        <ReadOnlyBar
          workspaceName={view.profile?.name ?? session.workspaceId}
          expiresAt={expiresAt}
        />
      ) : null}
      <Link href="/support" className="text-ink-muted text-sm underline-offset-2 hover:underline">
        ← Support sessions
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="page-title" className="text-lg font-semibold">
          Support session
        </h1>
        <SessionStateChip state={state} />
      </div>

      <dl className="grid max-w-2xl grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">Workspace</dt>
        <dd className="font-mono text-xs">{session.workspaceId}</dd>
        <dt className="text-ink-muted">Access</dt>
        <dd>{session.scope === 'view' ? 'Read-only view' : 'Plan and usage details only'}</dd>
        <dt className="text-ink-muted">Reason</dt>
        <dd data-slot="support-session-reason">{session.reason}</dd>
        <dt className="text-ink-muted">Requested</dt>
        <dd>{dateTime(session.createdAt)}</dd>
        <dt className="text-ink-muted">Granted</dt>
        <dd>{dateTime(session.grantedAt)}</dd>
        <dt className="text-ink-muted">Ends</dt>
        <dd>{dateTime(session.endedAt ?? session.expiresAt)}</dd>
      </dl>

      {state === 'active' && expiresAt !== null ? (
        <div
          data-slot="support-active-banner"
          className="border-danger bg-danger-soft text-ink flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2 text-sm"
        >
          <span className="font-medium">Session active.</span>
          <SessionCountdown expiresAt={expiresAt} />
          <span className="ml-auto">
            <EndSessionButton sessionId={session.id} />
          </span>
        </div>
      ) : state === 'requested' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-slot="support-state-note">
          <p>{STATE_NOTE.requested}</p>
          <EndSessionButton sessionId={session.id} pending />
        </div>
      ) : state === 'active' ? null : (
        <p className="text-ink-muted text-sm" data-slot="support-state-note">
          {STATE_NOTE[state]}
        </p>
      )}

      {state === 'active' && session.scope === 'metadata' ? (
        <p className="text-ink-muted text-sm" data-slot="support-state-note">
          A metadata session never shows workspace content.
        </p>
      ) : null}

      {view === null ? null : (
        <div data-slot="support-view" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Workspace profile</CardTitle>
            </CardHeader>
            <CardContent>
              {view.profile === null ? (
                <p className="text-ink-muted text-sm">This workspace has been deleted.</p>
              ) : (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-ink-muted">Name</dt>
                  <dd>{view.profile.name}</dd>
                  <dt className="text-ink-muted">Address</dt>
                  <dd className="font-mono text-xs">/w/{view.profile.slug}</dd>
                  <dt className="text-ink-muted">Kind</dt>
                  <dd>{view.profile.kind}</dd>
                  <dt className="text-ink-muted">Time zone</dt>
                  <dd>{view.profile.timezone}</dd>
                  <dt className="text-ink-muted">Language</dt>
                  <dd>{view.profile.locale}</dd>
                  <dt className="text-ink-muted">City</dt>
                  <dd>{view.profile.practiceCity ?? '—'}</dd>
                </dl>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm" aria-label="Members">
                {view.members.map((m, i) => (
                  <li key={`${m.name}-${String(i)}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <Badge tone="neutral">{m.role}</Badge>
                    <span className="text-ink-muted text-xs">joined {dateTime(m.joinedAt)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
