'use client';
// The enquiry log (#874, #87): one card per enquiry with its status, a conflict check and the
// outcome actions, and the empty and offline states. Shortcuts: `n` opens the new-enquiry form, `c`
// runs the conflict check on the selected enquiry, `j`/`k` move the selection, `Esc` clears it;
// `Cmd/Ctrl+Enter` saves the form. Plain keys are ignored while typing (useHotkey). Offline, the log
// is read-only. Nothing here sends anything to the enquirer.
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { useHotkey } from '@causedeck/ui/hooks';
import { OfflineBanner } from '@causedeck/ui/patterns';
import { Inbox } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type {
  ConflictCheckView,
  EnquiryRowView,
} from '../../../../../../../lib/intake/intake-deps.ts';
import {
  useOfflineSince,
  useOnline,
} from '../../../../../../../components/matters/matters-offline-banner.tsx';

import { ConflictPanel, type ConflictDecision } from './conflict-panel.tsx';
import { enquiryErrorKey, type EnquiryActions } from './enquiry-actions.ts';
import { EnquiryForm } from './enquiry-form.tsx';
import { OutcomeDialog } from './outcome-dialog.tsx';

export interface EnquiryListProps {
  workspaceId: string;
  enquiries: readonly EnquiryRowView[];
  actions: EnquiryActions;
  /** Dev preview of the offline banner. */
  forceOffline?: boolean;
}

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;
const isOpen = (e: EnquiryRowView) => e.status === 'logged' || e.status === 'checked';

export function EnquiryList({
  workspaceId,
  enquiries,
  actions,
  forceOffline = false,
}: EnquiryListProps) {
  const t = useTranslations('enquiry');
  const router = useRouter();
  const online = useOnline() && !forceOffline;
  const [formOpen, setFormOpen] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ConflictCheckView>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async (id: string) => {
    if (!online || running !== null) return;
    setRunning(id);
    setError(null);
    try {
      const result = await actions.check({ workspaceId, enquiryId: id });
      if (result.ok) {
        setResults((prev) => ({ ...prev, [id]: result.data }));
        router.refresh();
      } else {
        setError(t(`form.error.${enquiryErrorKey(result.error.code)}`));
      }
    } catch {
      setError(t('form.error.failed'));
    } finally {
      setRunning(null);
    }
  };

  const decide = async (id: string, decision: ConflictDecision, note: string) => {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        decision === 'proceed'
          ? await actions.accept({
              workspaceId,
              enquiryId: id,
              ...(note === '' ? {} : { title: note }),
            })
          : await actions.update({
              workspaceId,
              enquiryId: id,
              status: decision === 'decline' ? 'declined' : 'referred',
            });
      if (result.ok) {
        setActive(null);
        router.refresh();
      } else {
        setError(t(`form.error.${enquiryErrorKey(result.error.code)}`));
      }
    } catch {
      setError(t('form.error.failed'));
    } finally {
      setBusy(false);
    }
  };

  useHotkey(
    'n',
    (event) => {
      if (event.shiftKey || !online || dialogOpen()) return;
      event.preventDefault();
      setFormOpen(true);
    },
    { preventDefault: false },
  );
  useHotkey(
    'c',
    (event) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey || dialogOpen()) return;
      const row = enquiries.find((e) => e.id === active);
      if (row === undefined || !isOpen(row)) return;
      event.preventDefault();
      void runCheck(row.id);
    },
    { preventDefault: false },
  );
  const move = (step: 1 | -1) => (event: KeyboardEvent) => {
    if (event.shiftKey || dialogOpen() || enquiries.length === 0) return;
    event.preventDefault();
    const index = enquiries.findIndex((e) => e.id === active);
    const next = index < 0 ? (step === 1 ? 0 : enquiries.length - 1) : index + step;
    const id = enquiries[Math.min(Math.max(next, 0), enquiries.length - 1)]?.id ?? null;
    setActive(id);
    document.querySelector<HTMLElement>(`[data-enquiry-row="${id ?? ''}"]`)?.focus();
  };
  useHotkey('j', move(1), { preventDefault: false });
  useHotkey('k', move(-1), { preventDefault: false });
  useHotkey(
    'escape',
    () => {
      if (!dialogOpen()) setActive(null);
    },
    { preventDefault: false },
  );

  const newButton = (
    <Button
      type="button"
      data-slot="new-enquiry"
      disabled={!online}
      title={online ? undefined : t('offline')}
      onClick={() => {
        setFormOpen(true);
      }}
    >
      {t('new.trigger')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <OfflineNotice forced={forceOffline} />
      <div className="flex justify-end">{newButton}</div>
      {error === null ? null : (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {enquiries.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          icon={<Inbox />}
          title={t('empty.title')}
          description={t('empty.body')}
          action={newButton}
        />
      ) : (
        <ul aria-label={t('list.label')} className="flex flex-col gap-2">
          {enquiries.map((row) => (
            <li
              key={row.id}
              data-enquiry-row={row.id}
              data-active={row.id === active ? '' : undefined}
              tabIndex={-1}
              className="border-line bg-surface flex flex-col gap-3 rounded-md border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.enquirerName}</span>
                <Badge tone={isOpen(row) ? 'info' : 'neutral'}>{t(`status.${row.status}`)}</Badge>
                <span className="text-ink-muted text-xs">{t(`channels.${row.channel}`)}</span>
              </div>
              <p className="text-sm">{row.summary}</p>
              {row.closedReason === null ? null : (
                <p className="text-ink-muted text-xs">{row.closedReason}</p>
              )}
              {isOpen(row) ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    data-enquiry-action="select"
                    aria-pressed={row.id === active}
                    onClick={() => {
                      setActive(row.id === active ? null : row.id);
                    }}
                  >
                    {t('row.review')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    data-enquiry-action="close"
                    disabled={!online}
                    onClick={() => {
                      setClosing(row.id);
                    }}
                  >
                    {t('row.close')}
                  </Button>
                </div>
              ) : null}
              {row.id === active && isOpen(row) ? (
                <>
                  <Button
                    type="button"
                    data-enquiry-action="check"
                    disabled={!online || running !== null}
                    onClick={() => {
                      void runCheck(row.id);
                    }}
                  >
                    {t('row.check')}
                  </Button>
                  <ConflictPanel
                    result={results[row.id] ?? null}
                    running={running === row.id}
                    disabled={!online || busy}
                    error={null}
                    onDecide={(decision, note) => {
                      void decide(row.id, decision, note);
                    }}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <EnquiryForm
        workspaceId={workspaceId}
        open={formOpen}
        onOpenChange={setFormOpen}
        offline={!online}
        log={actions.log}
      />
      <OutcomeDialog
        workspaceId={workspaceId}
        enquiryId={closing}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
        offline={!online}
        close={actions.close}
      />
    </div>
  );
}

/** The offline banner with enquiry copy: the log is the last saved one and read-only. */
function OfflineNotice({ forced }: { forced: boolean }) {
  const t = useTranslations('enquiry');
  const locale = useLocale();
  const offlineSince = useOfflineSince();
  const since = offlineSince ?? (forced ? new Date(0) : null);
  if (since === null) return null;
  return (
    <OfflineBanner
      data-enquiries-offline=""
      savedAt={since}
      locale={`${locale}-IN`}
      labels={{ message: () => t('offline') }}
    />
  );
}
