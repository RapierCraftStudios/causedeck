'use client';
// `<BootstrapImport />` (#552, #57 part 6): the stepper of the bootstrap import. Choose files ->
// upload each as a `bulk_import` capture -> add them to a batch -> (ask for the member's
// identifiers when none are saved) -> watch the files being read. #92 embeds it in onboarding;
// #551 takes over at `onPlanReady` with the confirm grid. Nothing is created here: applying the
// plan is a later step.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { enableChannelAction } from '../../app/(app)/w/[slug]/inbox/actions.ts';
import {
  addImportFilesAction,
  buildImportPlanAction,
  importProgressAction,
  startImportBatchAction,
  type ImportProgressView,
} from '../../app/(app)/w/[slug]/import/actions.ts';
import {
  admitFiles,
  sha256Hex,
  type Candidate,
  type ImportEntry,
} from '../../lib/import/file-rules.ts';
import { runLimited, uploadImportFile } from '../../lib/import/upload-batch.ts';
import { useOnline } from '../settings/settings-offline-banner.tsx';

import { DropZone } from './drop-zone.tsx';
import { FileList } from './file-list.tsx';
import { IdentifiersForm, type Identifiers } from './identifiers-form.tsx';
import { ProcessingView } from './processing-view.tsx';

export interface BootstrapImportProps {
  workspaceId: string;
  /** `bulk_import` accepts captures only after a manager turned it on (#43). */
  channelEnabled: boolean;
  canEnableChannel: boolean;
  /** `CAPTURE_DISCLOSURE_VERSION`, sent when the channel is turned on. */
  disclosureVersion: string;
  /** Called with the batch id when the plan is ready; the confirm grid (#551) takes it from there. */
  onPlanReady?: ((batchId: string) => void) | undefined;
}

type Phase = 'select' | 'uploading' | 'identifiers' | 'processing';

const UPLOAD_CONCURRENCY = 3;
const POLL_MS = 3000;

export function BootstrapImport({
  workspaceId,
  channelEnabled,
  canEnableChannel,
  disclosureVersion,
  onPlanReady,
}: BootstrapImportProps) {
  const t = useTranslations('bootstrapImport');
  const online = useOnline();
  const [enabled, setEnabled] = useState(channelEnabled);
  const [enableFailed, setEnableFailed] = useState(false);
  const [entries, setEntries] = useState<ImportEntry[]>([]);
  const [refused, setRefused] = useState(0);
  const [phase, setPhase] = useState<Phase>('select');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgressView | null>(null);
  const [proposed, setProposed] = useState<Identifiers | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const files = useRef(new Map<string, File>());
  const added = useRef(new Set<string>());
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const patch = (id: string, change: Partial<ImportEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    );
  };

  async function onFiles(dropped: File[]) {
    setFailed(false);
    const candidates: Candidate[] = [];
    const room = Math.max(0, 200 - entriesRef.current.length);
    // Only the files that will be listed are hashed.
    const listed = dropped.slice(0, room);
    await runLimited(listed, UPLOAD_CONCURRENCY, async (file) => {
      const id = crypto.randomUUID();
      files.current.set(id, file);
      candidates.push({
        id,
        name: file.name,
        sizeBytes: file.size,
        sha256: file.size > 0 ? await sha256Hex(file) : null,
      });
    });
    // Back in drop order.
    const order = new Map(listed.map((file, index) => [file, index]));
    candidates.sort(
      (a, b) =>
        (order.get(files.current.get(a.id) as File) ?? 0) -
        (order.get(files.current.get(b.id) as File) ?? 0),
    );
    const admission = admitFiles(entriesRef.current, [
      ...candidates,
      ...dropped.slice(room).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        sizeBytes: file.size,
        sha256: null,
      })),
    ]);
    setEntries((current) => [...current, ...admission.added]);
    setRefused((count) => count + admission.refused);
  }

  async function plan(id: string, identifiers?: Identifiers, confirm?: boolean) {
    const result = await buildImportPlanAction({
      workspaceId,
      batchId: id,
      ...(identifiers === undefined ? {} : { identifiers }),
      ...(confirm === true ? { confirmIdentifiers: true } : {}),
    });
    if (!result.ok) throw new Error(result.error.code);
    if (result.data.status === 'needs_identifiers') {
      setProposed(null);
      setPhase('identifiers');
    } else if (result.data.status === 'confirm_identifiers') {
      setProposed(result.data.identifiers);
      setPhase('identifiers');
    } else {
      setPhase('processing');
    }
  }

  /** Upload what is queued, link it to the batch and ask for the plan. */
  async function run() {
    setFailed(false);
    setBusy(true);
    setPhase('uploading');
    try {
      let id = batchId;
      if (id === null) {
        const started = await startImportBatchAction({ workspaceId });
        if (!started.ok) throw new Error(started.error.code);
        id = started.data.batchId;
        setBatchId(id);
      }
      const queued = entriesRef.current.filter((entry) => entry.status === 'queued');
      await runLimited(queued, UPLOAD_CONCURRENCY, async (entry) => {
        const file = files.current.get(entry.id);
        if (file === undefined || entry.sha256 === undefined) return;
        patch(entry.id, { status: 'uploading' });
        const outcome = await uploadImportFile(workspaceId, file, entry.sha256);
        if (!outcome.ok) patch(entry.id, { status: 'failed', reason: outcome.error });
        else if (outcome.duplicate) patch(entry.id, { status: 'duplicate' });
        else patch(entry.id, { status: 'uploaded', captureId: outcome.captureId });
        if (outcome.ok && !outcome.duplicate) files.current.delete(entry.id);
      });
      const captureIds = entriesRef.current.flatMap((entry) =>
        entry.status === 'uploaded' &&
        entry.captureId !== undefined &&
        !added.current.has(entry.captureId)
          ? [entry.captureId]
          : [],
      );
      if (captureIds.length > 0) {
        const linked = await addImportFilesAction({ workspaceId, batchId: id, captureIds });
        if (!linked.ok) throw new Error(linked.error.code);
        for (const captureId of captureIds) added.current.add(captureId);
      }
      if (added.current.size === 0) {
        setPhase('select');
        return;
      }
      await plan(id);
    } catch {
      setFailed(true);
      setPhase('select');
    } finally {
      setBusy(false);
    }
  }

  async function submitIdentifiers(identifiers: Identifiers, confirm: boolean) {
    if (batchId === null) return;
    setBusy(true);
    setFailed(false);
    try {
      await plan(batchId, identifiers, confirm);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function retryFailedFiles() {
    if (batchId === null) return;
    setBusy(true);
    try {
      await plan(batchId);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function turnOn() {
    setEnableFailed(false);
    const result = await enableChannelAction({
      workspaceId,
      channel: 'bulk_import',
      disclosureVersion,
    });
    if (result.ok) setEnabled(true);
    else setEnableFailed(true);
  }

  const finished = progress?.status === 'ready' || progress?.status === 'failed';
  useEffect(() => {
    if (phase !== 'processing' || batchId === null || finished) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await importProgressAction({ workspaceId, batchId }).catch(() => null);
      if (stopped) return;
      if (result?.ok === true) setProgress(result.data);
      if (
        result?.ok === true &&
        (result.data.status === 'ready' || result.data.status === 'failed')
      ) {
        return;
      }
      timer = setTimeout(() => {
        void poll();
      }, POLL_MS);
    };
    timer = setTimeout(() => {
      void poll();
    }, 0);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [phase, batchId, workspaceId, finished]);

  const queued = entries.filter((entry) => entry.status === 'queued').length;
  const selecting = phase === 'select';

  return (
    <div data-slot="bootstrap-import" className="flex flex-col gap-4">
      {online ? null : (
        <Alert tone="warning" icon={<WifiOff />} data-pattern-state="offline">
          {t('drop.offline')}
        </Alert>
      )}
      {enabled ? null : (
        <Alert tone="warning" data-pattern-state="channel-off">
          <p className="font-medium">{t('channel.title')}</p>
          <p>{t('channel.body')}</p>
          {canEnableChannel ? (
            <Button type="button" size="sm" onClick={() => void turnOn()}>
              {t('channel.enable')}
            </Button>
          ) : (
            <p>{t('channel.ownerOnly')}</p>
          )}
          {enableFailed ? <p role="alert">{t('channel.failed')}</p> : null}
        </Alert>
      )}
      <p className="text-muted-foreground text-sm">{t('sensitive')}</p>
      {failed ? (
        <Alert tone="danger" data-pattern-state="error">
          <p>{t('error.action')}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run()}
          >
            {t('error.retry')}
          </Button>
        </Alert>
      ) : null}
      {entries.length === 0 ? (
        <div data-pattern-state="empty" className="flex flex-col gap-1">
          <h2 className="font-medium">{t('empty.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('empty.body')}</p>
        </div>
      ) : null}
      <DropZone
        disabled={!online || !enabled || !selecting}
        onFiles={(dropped) => void onFiles(dropped)}
      />
      {refused > 0 ? (
        <Alert tone="warning" data-pattern-state="over-limit">
          {t('drop.refused', { max: 200, n: refused })}
        </Alert>
      ) : null}
      {entries.length > 0 ? (
        <FileList
          entries={entries}
          onRetry={(id) => {
            patch(id, { status: 'queued' });
            entriesRef.current = entriesRef.current.map((entry) =>
              entry.id === id ? { ...entry, status: 'queued' } : entry,
            );
            void run();
          }}
        />
      ) : null}
      {selecting && queued > 0 ? (
        <div>
          <Button type="button" disabled={!online || !enabled || busy} onClick={() => void run()}>
            {t('start', { n: queued })}
          </Button>
        </div>
      ) : null}
      {phase === 'uploading' ? <p className="text-sm">{t('starting')}</p> : null}
      {phase === 'identifiers' ? (
        <IdentifiersForm
          proposed={proposed}
          busy={busy}
          onPropose={(identifiers) => void submitIdentifiers(identifiers, false)}
          onConfirm={(identifiers) => void submitIdentifiers(identifiers, true)}
          onEdit={() => {
            setProposed(null);
          }}
        />
      ) : null}
      {phase === 'processing' && progress !== null ? (
        <ProcessingView
          progress={progress}
          retrying={busy}
          onRetryFailed={() => void retryFailedFiles()}
          onReview={
            onPlanReady === undefined || batchId === null ? undefined : () => onPlanReady(batchId)
          }
        />
      ) : null}
    </div>
  );
}
