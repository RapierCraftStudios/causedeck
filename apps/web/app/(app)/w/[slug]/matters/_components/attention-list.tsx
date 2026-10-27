'use client';
// The stale-matter flag list (#70) for a matter and for the matters list: the `AttentionList`
// pattern with the member's own words from the `attention` catalog, and the snooze and dismiss
// server actions. A flag only explains; snoozing is a person's act with a reason and a day.
import type { AttentionFlag } from '@causedeck/validators/attention';
import { Button } from '@causedeck/ui/button';
import { AttentionList, type AttentionState } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { dismissFlagAction, snoozeFlagAction } from './attention-actions.ts';

export interface AttentionFlagListProps {
  workspaceId: string;
  flags: readonly AttentionFlag[];
  state?: AttentionState;
  canWrite: boolean;
  onRetry?: (() => void) | undefined;
  /** Called after a snooze or dismiss succeeds. */
  onChanged?: (() => void) | undefined;
}

export function AttentionFlagList({
  workspaceId,
  flags,
  state = 'default',
  canWrite,
  onRetry,
  onChanged,
}: AttentionFlagListProps) {
  const t = useTranslations('attention');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [snoozeKey, setSnoozeKey] = useState<string | null>(null);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const target = flags.find((f) => f.key === snoozeKey);

  const submit = (dismiss: boolean) => {
    if (target === undefined) return;
    start(async () => {
      const base = { workspaceId, matterId: target.matterId, rule: target.rule };
      const result = dismiss
        ? await dismissFlagAction(base)
        : await snoozeFlagAction({ ...base, until, reason });
      setFailed(!result.ok);
      if (result.ok) {
        setSnoozeKey(null);
        onChanged?.();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <AttentionList
        state={state}
        readOnly={!canWrite}
        openKey={openKey}
        onOpen={setOpenKey}
        onClose={() => {
          setOpenKey(null);
          setSnoozeKey(null);
        }}
        onSnooze={setSnoozeKey}
        onRetry={onRetry}
        flags={flags.map((f) => ({
          key: f.key,
          matterTitle: f.matterTitle,
          rule: f.rule,
          evidence: f.evidence,
          since: f.since,
          suggestedAction: t(`actions.${f.actionKind}`),
        }))}
        labels={{
          title: t('title'),
          empty: t('empty'),
          loading: t('loading'),
          error: t('error'),
          retry: t('retry'),
          offline: t('offline'),
          denied: t('denied'),
          snooze: t('snooze.action'),
          openEvidence: t('openEvidence'),
          close: t('close'),
          hint: t('snooze.hint'),
          rule: (rule, count) =>
            t('groupCount', { rule: t(`rules.${rule as AttentionFlag['rule']}`), count }),
          since: (date) => t('since', { date }),
        }}
      />
      {target === undefined || !canWrite ? null : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('snooze.until')}
            <input
              type="date"
              required
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
              }}
              className="rounded-md border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('snooze.reason')}
            <input
              type="text"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
              className="rounded-md border px-2 py-1"
            />
          </label>
          {failed ? (
            <p role="alert" className="text-sm">
              {t('error')}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {t('snooze.submit')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                submit(true);
              }}
            >
              {t('snooze.dismiss')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
