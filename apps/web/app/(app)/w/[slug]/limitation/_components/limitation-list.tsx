'use client';
// The limitation list (#941, #84): one card per computation, a Propose button for owners and
// advocates, and the empty, no-rules and offline states. Shortcuts: `p` opens the propose form,
// `Enter` confirms the selected proposal, `Esc` clears the selection (the dialog closes itself);
// plain keys are ignored while typing (useHotkey) and while a dialog is open. Offline, the list is
// read-only. Transitions honour reduced motion (motion-reduce). Dates are proposals: nothing is
// filed or scheduled until confirmed.
import type { ComputationView, RuleView } from '@causedeck/core/limitation';
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { useHotkey } from '@causedeck/ui/hooks';
import { OfflineBanner } from '@causedeck/ui/patterns';
import { Hourglass } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  useOfflineSince,
  useOnline,
} from '../../../../../../components/matters/matters-offline-banner.tsx';

import { ComputationCard } from './computation-card.tsx';
import { limitationErrorKey, type LimitationActions } from './limitation-actions.ts';
import { ProposeForm } from './propose-form.tsx';

export interface LimitationListProps {
  workspaceId: string;
  computations: readonly ComputationView[];
  /** Reviewed and draft rules; empty for a clerk or viewer. */
  rules: readonly RuleView[];
  /** Owners and advocates compute and confirm. */
  canWrite: boolean;
  actions: LimitationActions;
  /** Dev preview of the offline banner. */
  forceOffline?: boolean;
}

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;

export function LimitationList({
  workspaceId,
  computations,
  rules,
  canWrite,
  actions,
  forceOffline = false,
}: LimitationListProps) {
  const t = useTranslations('limitation');
  const router = useRouter();
  const online = useOnline() && !forceOffline;
  const reviewed = rules.filter((r) => r.reviewed);
  const canPropose = canWrite && online && reviewed.length > 0;
  const [formOpen, setFormOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (id: string) => {
    setBusy(true);
    setError(null);
    const result = await actions.confirm({ workspaceId, computationId: id });
    setBusy(false);
    if (!result.ok) {
      setError(t(`form.error.${limitationErrorKey(result.error.code)}`));
      return;
    }
    router.refresh();
  };

  useHotkey(
    'p',
    (event) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey || !canPropose || dialogOpen()) return;
      event.preventDefault();
      setFormOpen(true);
    },
    { preventDefault: false },
  );
  useHotkey(
    'enter',
    (event) => {
      if (!canWrite || !online || busy || dialogOpen()) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, a, input, select, textarea')) {
        return;
      }
      const row = computations.find((c) => c.id === active);
      if (row === undefined || row.status !== 'proposed') return;
      event.preventDefault();
      void confirm(row.id);
    },
    { preventDefault: false },
  );
  useHotkey(
    'escape',
    () => {
      if (!dialogOpen()) setActive(null);
    },
    { preventDefault: false },
  );

  const proposeButton = canWrite ? (
    <Button
      type="button"
      data-slot="propose-limitation"
      disabled={!canPropose}
      title={online ? undefined : t('offline')}
      onClick={() => {
        setFormOpen(true);
      }}
    >
      {t('form.trigger')}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <OfflineNotice forced={forceOffline} />
      <div className="flex items-center justify-between gap-3">
        <p data-slot="limitation-verify-label" className="text-ink-muted text-sm">
          {t('verifyLabel')}
        </p>
        {proposeButton}
      </div>
      {error === null ? null : (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {computations.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          icon={<Hourglass />}
          title={t('empty.title')}
          description={t('empty.body')}
          action={proposeButton}
        />
      ) : (
        <ul aria-label={t('list.label')} className="flex flex-col gap-2">
          {computations.map((computation) => (
            <ComputationCard
              key={computation.id}
              computation={computation}
              rule={rules.find((r) => r.id === computation.ruleId)}
              selected={computation.id === active}
              canConfirm={canWrite}
              offline={!online}
              busy={busy}
              onSelect={setActive}
              onConfirm={(id) => {
                void confirm(id);
              }}
            />
          ))}
        </ul>
      )}

      <ProposeForm
        workspaceId={workspaceId}
        open={formOpen}
        onOpenChange={setFormOpen}
        rules={reviewed}
        offline={!online}
        compute={actions.compute}
      />
      <p className="text-ink-muted text-xs" data-slot="limitation-shortcuts">
        {t('shortcuts.propose')} · {t('shortcuts.confirm')} · {t('shortcuts.close')}
      </p>
    </div>
  );
}

function OfflineNotice({ forced }: { forced: boolean }) {
  const t = useTranslations('limitation');
  const locale = useLocale();
  const offlineSince = useOfflineSince();
  const since = offlineSince ?? (forced ? new Date(0) : null);
  if (since === null) return null;
  return (
    <OfflineBanner
      data-limitation-offline=""
      savedAt={since}
      locale={`${locale}-IN`}
      labels={{ message: () => t('offline') }}
    />
  );
}
