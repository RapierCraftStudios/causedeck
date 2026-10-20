'use client';
// One flag on the flags page (#311), and one pending legal-gated request. Every change opens a
// confirmation that restates the diff (old → new) before it is applied. Enabling a legal-gated flag
// asks for the legal note, the acknowledgement and a fresh TOTP code, and only sends a request: a
// second admin applies it. A flag forced off by its env kill switch says so and cannot be toggled.
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Switch } from '@causedeck/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@causedeck/ui/table';
import { Textarea } from '@causedeck/ui/textarea';
import { useActionState, useState } from 'react';

import type { FlagRowView, PendingRequestView } from '../../../lib/flags.ts';
import {
  approveLegalEnableAction,
  rejectLegalEnableAction,
  requestLegalEnableAction,
  setFlagAction,
  type FlagActionState,
} from './actions.ts';

const INITIAL: FlagActionState = {};

export const FORCED_OFF = 'Forced off by environment';

const onOff = (value: boolean) => (value ? 'On' : 'Off');

/** The value shown for a scope's row: `null` is no row (default off, or inherit the global row). */
export function scopeValueLabel(value: boolean | null, workspace: boolean): string {
  if (value === null) return workspace ? 'Inherit' : 'Off (default)';
  return onOff(value);
}

/** `<key> · <scope> · <old> → <new>`: what the change does, restated before it is applied. */
export function diffSummary(flag: FlagRowView, workspaceId: string | undefined, next: boolean) {
  const current = workspaceId === undefined ? flag.global : flag.override;
  const scope = workspaceId === undefined ? 'Global' : `Workspace ${workspaceId}`;
  return `${flag.key} · ${scope} · ${scopeValueLabel(current, workspaceId !== undefined)} → ${onOff(next)}`;
}

function ActionMessage({ state }: { state: FlagActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-danger text-sm">
        {state.error}
      </p>
    );
  }
  return state.done ? (
    <p role="status" className="text-success text-sm">
      {state.done}
    </p>
  ) : null;
}

function TotpField({ id }: { id: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Authenticator code</Label>
      <Input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        required
      />
    </div>
  );
}

export interface FlagRowProps {
  flag: FlagRowView;
  /** The workspace whose override this row changes; omitted for the global row. */
  workspaceId?: string | undefined;
  /** Whether a fresh TOTP code is asked for (not for the dev staff account outside production). */
  totpRequired: boolean;
}

export function FlagRow({ flag, workspaceId, totpRequired }: FlagRowProps) {
  const current = workspaceId === undefined ? flag.global : flag.override;
  const next = current !== true;
  const legal = flag.legalGated && next;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [code, setCode] = useState('');
  // Close the dialog once a change is applied (or a request sent).
  const closingOnDone =
    (action: typeof setFlagAction) => async (previous: FlagActionState, formData: FormData) => {
      const result = await action(previous, formData);
      if (result.done) setOpen(false);
      return result;
    };
  const [setState, setAction, setPending] = useActionState(closingOnDone(setFlagAction), INITIAL);
  const [requestState, requestAction, requestPending] = useActionState(
    closingOnDone(requestLegalEnableAction),
    INITIAL,
  );
  const state = legal ? requestState : setState;
  const pending = legal ? requestPending : setPending;

  const ready =
    !legal || (note.trim() !== '' && acknowledged && (!totpRequired || code.trim() !== ''));
  const idBase = `${flag.key}-${workspaceId ?? 'global'}`;

  return (
    <TableRow data-testid={`flag-row-${flag.key}`}>
      <TableCell>
        <div className="grid gap-0.5">
          <span className="font-mono text-sm">{flag.key}</span>
          <span className="text-ink-muted text-xs">{flag.description}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {flag.legalGated ? <Badge tone="warning">⚖ Legal-gated</Badge> : null}
          {flag.killed ? (
            <Badge tone="danger" title={flag.killSwitchEnv}>
              {FORCED_OFF}
            </Badge>
          ) : null}
        </div>
        {flag.killed ? (
          <span className="text-ink-muted font-mono text-xs">{flag.killSwitchEnv}</span>
        ) : null}
      </TableCell>
      <TableCell>{scopeValueLabel(current, workspaceId !== undefined)}</TableCell>
      <TableCell>{onOff(flag.effective)}</TableCell>
      <TableCell>
        <Switch
          checked={current === true}
          disabled={flag.killed}
          aria-label={`${flag.key}: turn ${next ? 'on' : 'off'}`}
          onCheckedChange={() => {
            setOpen(true);
          }}
        />
        <ActionMessage state={open ? INITIAL : state} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <form action={legal ? requestAction : setAction} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>
                  Turn {flag.key} {next ? 'on' : 'off'}?
                </DialogTitle>
                <DialogDescription data-testid="flag-diff">
                  {diffSummary(flag, workspaceId, next)}
                </DialogDescription>
              </DialogHeader>
              <input type="hidden" name="key" value={flag.key} />
              <input type="hidden" name="workspaceId" value={workspaceId ?? ''} />
              <input type="hidden" name="enabled" value={String(next)} />
              {flag.killed ? (
                <p className="text-warning text-sm">
                  Effective value stays off: {FORCED_OFF.toLowerCase()} ({flag.killSwitchEnv}).
                </p>
              ) : null}
              {legal ? (
                <>
                  <p className="text-sm">
                    Needs approval by a second admin before it takes effect.
                  </p>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${idBase}-note`}>Legal note</Label>
                    <Textarea
                      id={`${idBase}-note`}
                      name="note"
                      required
                      maxLength={2000}
                      value={note}
                      onChange={(e) => {
                        setNote(e.target.value);
                      }}
                      placeholder="The counsel deliverable that allows this, e.g. #120"
                    />
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`${idBase}-ack`}
                      checked={acknowledged}
                      onCheckedChange={(v) => {
                        setAcknowledged(v === true);
                      }}
                    />
                    <Label htmlFor={`${idBase}-ack`}>
                      I confirm counsel has approved enabling this flag
                    </Label>
                    {acknowledged ? <input type="hidden" name="acknowledged" value="on" /> : null}
                  </div>
                  {totpRequired ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${idBase}-code`}>Authenticator code</Label>
                      <Input
                        id={`${idBase}-code`}
                        name="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9 ]*"
                        maxLength={7}
                        required
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value);
                        }}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
              <ActionMessage state={state.error ? state : INITIAL} />
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={pending} disabled={!ready}>
                  {legal ? 'Send for approval' : 'Apply'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

export interface PendingRequestRowProps {
  request: PendingRequestView;
  /** The viewer is an admin (only admins approve or reject someone else's request). */
  admin: boolean;
  totpRequired: boolean;
}

export function PendingRequestRow({ request, admin, totpRequired }: PendingRequestRowProps) {
  const [open, setOpen] = useState(false);
  const [approveState, approveAction, approving] = useActionState(
    async (previous: FlagActionState, formData: FormData) => {
      const result = await approveLegalEnableAction(previous, formData);
      if (result.done) setOpen(false);
      return result;
    },
    INITIAL,
  );
  const [rejectState, rejectAction, rejecting] = useActionState(rejectLegalEnableAction, INITIAL);
  const canDecide = admin && !request.own;

  return (
    <TableRow data-testid={`pending-${request.id}`}>
      <TableCell className="font-mono text-sm">{request.key}</TableCell>
      <TableCell>
        {request.workspaceId === null ? 'Global' : `Workspace ${request.workspaceId}`}
      </TableCell>
      <TableCell className="max-w-80 text-sm whitespace-pre-wrap">{request.legalAckNote}</TableCell>
      <TableCell className="text-xs">
        <time dateTime={request.requestedAt}>
          {request.requestedAt.replace('T', ' ').slice(0, 16)}
        </time>
        {request.own ? ' · yours' : null}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          {canDecide ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setOpen(true);
              }}
            >
              Approve
            </Button>
          ) : null}
          {canDecide || request.own ? (
            <form action={rejectAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <Button type="submit" size="sm" variant="secondary" loading={rejecting}>
                {request.own ? 'Withdraw' : 'Reject'}
              </Button>
            </form>
          ) : (
            <span className="text-ink-muted text-xs">Waiting for an admin</span>
          )}
        </div>
        <ActionMessage state={approveState.done ? approveState : rejectState} />
        {canDecide ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <form action={approveAction} className="grid gap-4">
                <DialogHeader>
                  <DialogTitle>Approve {request.key}?</DialogTitle>
                  <DialogDescription data-testid="approve-diff">
                    {request.key} ·{' '}
                    {request.workspaceId === null ? 'Global' : `Workspace ${request.workspaceId}`} ·
                    Off → On
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm whitespace-pre-wrap">{request.legalAckNote}</p>
                <input type="hidden" name="requestId" value={request.id} />
                {totpRequired ? <TotpField id={`approve-${request.id}-code`} /> : null}
                <ActionMessage state={approveState.error ? approveState : INITIAL} />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" loading={approving}>
                    Approve and apply
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

// The tables live here, not in page.tsx: `@causedeck/ui/table` keeps its density in React context,
// which only works in a client component.

export interface FlagTableProps {
  label: string;
  flags: FlagRowView[];
  workspaceId?: string | undefined;
  totpRequired: boolean;
}

export function FlagTable({ label, flags, workspaceId, totpRequired }: FlagTableProps) {
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

export interface PendingRequestsTableProps {
  requests: PendingRequestView[];
  admin: boolean;
  totpRequired: boolean;
}

export function PendingRequestsTable({ requests, admin, totpRequired }: PendingRequestsTableProps) {
  return (
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
        {requests.map((request) => (
          <PendingRequestRow
            key={request.id}
            request={request}
            admin={admin}
            totpRequired={totpRequired}
          />
        ))}
      </TableBody>
    </Table>
  );
}
