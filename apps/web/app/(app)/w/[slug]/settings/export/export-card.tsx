'use client';
// The export card (#305, #31 design spec): `Export everything` with `Request export` and the
// helper text, next to the History card (one column at 360 px, two cards from 768 px). While the
// newest export is queued or building, the card polls every 3 s and shows a progress bar with the
// build step (`Collecting records`, `Decrypting files`, `Packaging`); polling stops once it is
// ready, failed or expired, and on unmount. Ready: the file name, size, an expiry countdown,
// `Download` (asks the download route for a signed link, then follows it) and `Copy SHA-256`.
// Failed: a danger alert with `Try again`. A stale step-up opens `Confirm it is you` and retries.
// Offline, every action is disabled with `Needs a connection`.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Progress } from '@causedeck/ui/progress';
import { toast } from '@causedeck/ui/sonner';
import { Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import {
  needsStepUp,
  StepUpVerify,
  type VerifyCode,
} from '../../../../../../components/settings/step-up-verify.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';

import {
  effectiveStatus,
  ExportHistory,
  formatSize,
  type ExportJobView,
} from './export-history.tsx';

/** Poll interval while an export is queued or building (#31 spec). */
export const EXPORT_POLL_MS = 3000;

const HOUR_MS = 60 * 60 * 1000;
const STEPS = ['collecting', 'files', 'packaging'] as const;

type ExportAction = (input: { workspaceId: string }) => Promise<Result<ExportJobView>>;
type ListAction = (input: { workspaceId: string }) => Promise<Result<ExportJobView[]>>;

export interface ExportCardProps {
  workspaceId: string;
  initialJobs: ExportJobView[];
  /** The server's clock at render, so the first paint matches (epoch ms). */
  initialNow: number;
  twoFactorEnabled: boolean;
  requestExport: ExportAction;
  listExports: ListAction;
  verifyCode: VerifyCode;
  /** Injected in tests. */
  passkey?: () => Promise<boolean>;
}

const building = (job: ExportJobView | undefined) =>
  job !== undefined && (job.status === 'queued' || job.status === 'running');

async function downloadLink(jobId: string, workspaceId: string): Promise<string | null> {
  const response = await fetch(`/api/exports/${jobId}/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { url?: unknown };
  return typeof body.url === 'string' ? body.url : null;
}

export function ExportCard({
  workspaceId,
  initialJobs,
  initialNow,
  twoFactorEnabled,
  requestExport,
  listExports,
  verifyCode,
  passkey,
}: ExportCardProps) {
  const t = useTranslations('lifecycle');
  const online = useOnline();
  const id = useId();
  const [jobs, setJobs] = useState<ExportJobView[]>(initialJobs);
  const [now, setNow] = useState(initialNow);
  const [pending, setPending] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = jobs[0];
  const active = building(latest);

  // Poll while the newest export builds; stop when it settles or the card unmounts.
  useEffect(() => {
    if (!active) return;
    let live = true;
    const timer = setInterval(() => {
      void listExports({ workspaceId })
        .then((result) => {
          if (live && result.ok) setJobs(result.data);
        })
        .catch(() => undefined);
    }, EXPORT_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, listExports, workspaceId]);

  // The expiry countdown ticks once a minute.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  async function onRequest() {
    setError(null);
    setPending(true);
    let result: Result<ExportJobView>;
    try {
      result = await requestExport({ workspaceId });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      setStepUp(false);
      const job = result.data;
      setJobs((current) => [job, ...current.filter((other) => other.id !== job.id)].slice(0, 5));
      return;
    }
    if (needsStepUp(result)) {
      setStepUp(true);
      return;
    }
    setError(t('export.requestError'));
  }

  async function onDownload(job: ExportJobView) {
    setError(null);
    let url: string | null = null;
    try {
      url = await downloadLink(job.id, workspaceId);
    } catch {
      url = null;
    }
    if (url === null) {
      setError(t('export.downloadError'));
      return;
    }
    window.location.assign(url);
  }

  async function onCopy(sha256: string) {
    try {
      await navigator.clipboard.writeText(sha256);
      toast(t('export.copied'));
    } catch {
      toast(t('export.copyFailed'));
    }
  }

  const status = latest ? effectiveStatus(latest, now) : null;
  const offlineReason = online ? undefined : t('offline');
  const requestButton = (label: string) => (
    <Button
      type="button"
      data-slot="export-start"
      disabled={!online || pending || active}
      loading={pending}
      aria-describedby={`${id}-helper`}
      title={offlineReason}
      onClick={() => void onRequest()}
    >
      {label}
    </Button>
  );

  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-start">
      <SettingSection id="export-card" title={t('export.title')} data-slot="export-card">
        <div className="flex flex-col gap-4 py-3" data-export-state={status ?? 'empty'}>
          <p id={`${id}-helper`} className="text-ink-muted text-sm">
            {t('export.helper')}
          </p>
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}

          {latest && active ? (
            <div className="flex flex-col gap-2" data-slot="export-progress">
              <Progress
                value={latest.progress}
                aria-label={t('export.progressLabel')}
                aria-valuetext={`${String(latest.progress)}%`}
              />
              <p className="text-sm font-medium" aria-live="polite">
                {latest.status === 'queued' ||
                !STEPS.includes(latest.phase as (typeof STEPS)[number])
                  ? t('export.steps.queued')
                  : t(`export.steps.${latest.phase as (typeof STEPS)[number]}`)}
              </p>
              <p className="text-ink-muted text-sm">{t('export.leave')}</p>
            </div>
          ) : null}

          {latest && status === 'ready' ? (
            <div className="flex flex-col gap-2" data-slot="export-ready">
              <h3 className="text-base font-semibold">{t('export.readyTitle')}</h3>
              <p className="font-mono text-sm break-all">{`causedeck-export-${latest.id}.zip`}</p>
              <p className="text-ink-muted text-sm">
                {latest.sizeBytes === null ? null : `${formatSize(latest.sizeBytes)} · `}
                {latest.expiresAt === null
                  ? null
                  : t('export.expires', {
                      hours: Math.max(
                        0,
                        Math.floor((Date.parse(latest.expiresAt) - now) / HOUR_MS),
                      ),
                    })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!online}
                  title={offlineReason}
                  onClick={() => void onDownload(latest)}
                >
                  <Download aria-hidden />
                  {t('export.download')}
                </Button>
                {latest.sha256 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void onCopy(latest.sha256 ?? '')}
                  >
                    <Copy aria-hidden />
                    {t('export.copySha')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {latest && status === 'failed' ? (
            <Alert
              tone="danger"
              data-slot="export-failed"
              action={requestButton(t('export.retry'))}
            >
              {t('export.failed')}
            </Alert>
          ) : null}

          {stepUp ? (
            <StepUpVerify
              twoFactorEnabled={twoFactorEnabled}
              verifyCode={verifyCode}
              onVerified={() => void onRequest()}
              {...(passkey === undefined ? {} : { passkey })}
            />
          ) : null}

          {status === 'failed' ? null : (
            <div className="flex flex-col gap-1">
              {requestButton(t('export.action'))}
              {offlineReason ? (
                <span className="text-ink-muted text-xs">{offlineReason}</span>
              ) : null}
            </div>
          )}
        </div>
      </SettingSection>
      <ExportHistory jobs={jobs} now={now} />
    </div>
  );
}
