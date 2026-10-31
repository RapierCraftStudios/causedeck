'use client';
// The invite step (#92): invite juniors and a clerk by email, each with a role. Only the addresses
// typed here are invited, and only on `Send invitations`: no marketing, no address book. The clerk
// role starts restricted. Each row is checked with the same zod row as the server; an invalid row is
// marked and described. Sending uses the existing `inviteMembersAction` (seat limits, rate limits,
// audit and the console mail transport in development are its own); a row that failed says why and
// can be fixed in place. Skipping is allowed.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { InviteRow, ONBOARDING_INVITE_ROLES } from '@causedeck/validators/onboarding';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { StepActions } from './step-actions.tsx';
import type { StepScope } from './steps.ts';
import { useStepSubmit } from './use-step-submit.ts';

type Role = (typeof ONBOARDING_INVITE_ROLES)[number];

export type InviteOutcomeView =
  | { email: string; status: 'sent'; link?: string }
  | { email: string; status: 'seatLimit'; seats: number }
  | { email: string; status: 'forbidden' | 'rateLimited' | 'invalid' | 'conflict' | 'failed' };

export type SendInvites = (input: {
  workspaceId: string;
  emails: string[];
  role: Role;
}) => Promise<Result<{ results: InviteOutcomeView[] }>>;

interface Row {
  key: number;
  email: string;
  role: Role;
}

export interface InviteTableProps {
  scope: StepScope;
  /** The `inviteMembersAction` server action; injectable for tests and stories. */
  send: SendInvites;
}

export function InviteTable({ scope, send }: InviteTableProps) {
  const t = useTranslations('onboarding.invite');
  const [rows, setRows] = useState<Row[]>([{ key: 0, email: '', role: 'junior' }]);
  const [nextKey, setNextKey] = useState(1);
  const [bad, setBad] = useState<ReadonlySet<number>>(new Set());
  const [none, setNone] = useState(false);
  const [outcomes, setOutcomes] = useState<InviteOutcomeView[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const { submit, pending, online } = useStepSubmit(scope);

  const patch = (key: number, change: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const filled = rows.filter((row) => row.email.trim() !== '');
    setNone(filled.length === 0);
    const invalid = new Set(
      filled
        .filter((row) => !InviteRow.safeParse({ email: row.email.trim(), role: row.role }).success)
        .map((row) => row.key),
    );
    setBad(invalid);
    if (filled.length === 0 || invalid.size > 0) return;
    setBusy(true);
    setSendFailed(false);
    const results: InviteOutcomeView[] = [];
    try {
      // One request per role: the existing action invites a list of addresses under one role.
      for (const role of ONBOARDING_INVITE_ROLES) {
        const emails = filled.filter((row) => row.role === role).map((row) => row.email.trim());
        if (emails.length === 0) continue;
        const result = await send({ workspaceId: scope.workspaceId, emails, role });
        if (!result.ok) throw new Error('invite failed');
        results.push(...result.data.results);
      }
    } catch {
      setSendFailed(true);
    }
    setBusy(false);
    setOutcomes(results);
    if (results.length > 0 && results.every((outcome) => outcome.status === 'sent')) {
      await submit('invite');
    }
  }

  const failedRows = outcomes.filter((outcome) => outcome.status !== 'sent');
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" noValidate>
      {bad.size > 0 ? (
        <Alert tone="danger" role="alert">
          {t('errors.summary')}
        </Alert>
      ) : null}
      <ul aria-label={t('tableLabel')} className="flex flex-col gap-4">
        {rows.map((row, index) => (
          <li
            key={row.key}
            data-invite-row=""
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Field
                label={`${t('emailLabel')} ${String(index + 1)}`}
                error={bad.has(row.key) ? t('errors.email') : undefined}
              >
                <Input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder={t('emailPlaceholder')}
                  value={row.email}
                  onChange={(event) => {
                    patch(row.key, { email: event.target.value });
                  }}
                  disabled={busy || pending}
                  className="h-11"
                />
              </Field>
            </div>
            <div className="sm:w-44">
              <Field label={t('roleLabel')}>
                <Select
                  value={row.role}
                  onValueChange={(value) => {
                    const role = ONBOARDING_INVITE_ROLES.find((item) => item === value);
                    if (role) patch(row.key, { role });
                  }}
                  disabled={busy || pending}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ONBOARDING_INVITE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {t(`roles.${role}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {rows.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                aria-label={t('removeRow')}
                onClick={() => {
                  setRows((current) => current.filter((item) => item.key !== row.key));
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={rows.length >= 20}
        onClick={() => {
          setRows((current) => [...current, { key: nextKey, email: '', role: 'junior' }]);
          setNextKey((key) => key + 1);
        }}
      >
        <Plus aria-hidden="true" />
        {t('add')}
      </Button>
      {none ? <p className="text-danger text-sm">{t('errors.none')}</p> : null}
      <p className="text-ink-muted text-sm">{t('privacy')}</p>
      {outcomes.some((outcome) => outcome.status === 'sent') ? (
        <p role="status" className="text-sm">
          {t('sent', { count: outcomes.filter((outcome) => outcome.status === 'sent').length })}
        </p>
      ) : null}
      {outcomes.flatMap((outcome) =>
        outcome.status === 'sent' && outcome.link
          ? [
              <p key={outcome.email} className="text-ink-muted text-xs break-all">
                {t('devLink', { email: outcome.email, link: outcome.link })}
              </p>,
            ]
          : [],
      )}
      {failedRows.length > 0 ? (
        <Alert tone="danger" role="alert">
          <ul>
            {failedRows.map((outcome) => (
              <li key={outcome.email}>
                {t(`failed.${outcome.status as 'failed'}`, { email: outcome.email })}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {sendFailed ? <Alert tone="danger">{t('failed.failed', { email: '' })}</Alert> : null}
      <StepActions
        label={t('send')}
        pending={busy || pending}
        disabled={!online}
        onSkip={() => void submit('invite', undefined, true)}
      />
    </form>
  );
}
