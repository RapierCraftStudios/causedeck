'use client';
// The sender allow-list (#54): a table of exact addresses and domains (with kind and label) and a
// form to add one. Empty state: `No allowed senders yet.` The flag off reads `Not enabled yet` and
// the controls are disabled with that reason; offline disables them with the offline reason.
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { toast } from '@causedeck/ui/sonner';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import { DisabledWithReason, disabledReasonId } from '../disabled-with-reason.tsx';
import { SettingSection } from '../setting-section.tsx';
import { useOnline } from '../settings-offline-banner.tsx';

import { ALLOWLIST_KINDS, type ActionFn, type AllowlistEntry } from './types.ts';

export interface AllowlistCardProps {
  workspaceId: string;
  entries: AllowlistEntry[];
  /** The `capture.email-forward` flag. */
  enabled: boolean;
  add: ActionFn<AllowlistEntry>;
  remove: ActionFn<{ entryId: string }>;
}

export function AllowlistCard({
  workspaceId,
  entries: initial,
  enabled,
  add,
  remove,
}: AllowlistCardProps) {
  const t = useTranslations('emailIntake');
  const online = useOnline();
  const [entries, setEntries] = useState(initial);
  const [pattern, setPattern] = useState('');
  const [kind, setKind] = useState<string>(ALLOWLIST_KINDS[0]);
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const reason = !enabled ? t('notEnabledReason') : online ? null : t('offlineReason');
  const disabled = reason !== null || pending;
  const describedBy = reason === null ? undefined : disabledReasonId('email-allowlist');

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!navigator.onLine) {
      toast(t('offlineReason'));
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<typeof add>>;
    try {
      result = await add({ workspaceId, pattern, kind, ...(label.trim() === '' ? {} : { label }) });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      const code = result.error.code;
      toast(
        t(
          code === 'FORBIDDEN'
            ? 'toast.forbidden'
            : code === 'VALIDATION'
              ? 'toast.invalid'
              : 'toast.error',
        ),
      );
      return;
    }
    setEntries((current) => [...current, result.data]);
    setPattern('');
    setLabel('');
    toast(t('toast.added'));
  }

  async function onRemove(entry: AllowlistEntry) {
    if (!navigator.onLine) {
      toast(t('offlineReason'));
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<typeof remove>>;
    try {
      result = await remove({ workspaceId, entryId: entry.id });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    toast(t('toast.removed'));
  }

  return (
    <SettingSection
      id="email-allowlist-section"
      data-slot="email-allowlist"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t('allowlist.title')}
          {enabled ? null : (
            <Badge tone="neutral" data-slot="email-not-enabled">
              {t('notEnabled')}
            </Badge>
          )}
        </span>
      }
      description={t('allowlist.description')}
    >
      {entries.length === 0 ? (
        <p className="text-ink-muted py-3 text-sm" data-pattern-state="empty">
          {t('allowlist.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto py-3">
          <table className="w-full text-start text-sm" aria-label={t('allowlist.tableLabel')}>
            <thead>
              <tr className="text-ink-muted">
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {t('allowlist.pattern')}
                </th>
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {t('allowlist.kind')}
                </th>
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {t('allowlist.label')}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  <span className="sr-only">{t('allowlist.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-line border-t" data-slot="allowlist-row">
                  <td className="py-2 pe-3 font-mono">
                    {entry.pattern}
                    {entry.isDomain ? (
                      <Badge tone="neutral" className="ms-2">
                        {t('allowlist.domain')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-2 pe-3">
                    {ALLOWLIST_KINDS.includes(entry.kind as (typeof ALLOWLIST_KINDS)[number])
                      ? t(`allowlist.kinds.${entry.kind as (typeof ALLOWLIST_KINDS)[number]}`)
                      : entry.kind}
                  </td>
                  <td className="py-2 pe-3">{entry.label ?? ''}</td>
                  <td className="py-2 text-end">
                    <DisabledWithReason id={`email-allowlist-${entry.id}`} reason={reason}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        aria-label={t('allowlist.removeLabel', { pattern: entry.pattern })}
                        aria-describedby={
                          reason === null
                            ? undefined
                            : disabledReasonId(`email-allowlist-${entry.id}`)
                        }
                        onClick={() => {
                          void onRemove(entry);
                        }}
                      >
                        {t('allowlist.remove')}
                      </Button>
                    </DisabledWithReason>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="flex flex-col gap-3 py-3 md:flex-row md:items-end"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="allowlist-pattern" className="text-sm font-medium">
            {t('allowlist.pattern')}
          </label>
          <Input
            id="allowlist-pattern"
            value={pattern}
            required
            maxLength={254}
            disabled={disabled}
            aria-describedby="allowlist-pattern-hint"
            onChange={(event) => {
              setPattern(event.target.value);
            }}
          />
          <p id="allowlist-pattern-hint" className="text-ink-muted text-xs">
            {t('allowlist.patternHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="allowlist-kind" className="text-sm font-medium">
            {t('allowlist.kind')}
          </label>
          <select
            id="allowlist-kind"
            value={kind}
            disabled={disabled}
            className="border-line bg-surface h-9 rounded-md border px-2 text-sm"
            onChange={(event) => {
              setKind(event.target.value);
            }}
          >
            {ALLOWLIST_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`allowlist.kinds.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="allowlist-label" className="text-sm font-medium">
            {t('allowlist.label')}
          </label>
          <Input
            id="allowlist-label"
            value={label}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        </div>
        <DisabledWithReason id="email-allowlist" reason={reason}>
          <Button
            type="submit"
            variant="secondary"
            disabled={disabled}
            aria-busy={pending || undefined}
            aria-describedby={describedBy}
            className="w-full md:w-auto"
          >
            {pending ? t('allowlist.adding') : t('allowlist.add')}
          </Button>
        </DisabledWithReason>
      </form>
    </SettingSection>
  );
}
