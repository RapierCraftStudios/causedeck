'use client';
// The voice recorder sheet (#543): press-and-hold (or tap) to record, review, Save. The recording
// is written to the encrypted outbox the moment it is saved, before any network call, and uploads
// on the `voice` channel when online (on reconnect when offline). The microphone is asked for only
// on the first press and released as soon as the recording ends or the sheet closes: nothing
// records in the background. A bottom sheet at 360, a centred dialog at 768, a corner popover from
// 1280.
import { Alert, AlertDescription } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  matterFromSearch,
  registerVoiceCommand,
  VOICE_MATTER_KEY,
  VOICE_QUERY_KEY,
  wantsVoice,
} from '../../../lib/capture/voice/command-registration.ts';
import {
  startMicrophone,
  stopMicrophone,
  type MicrophoneStart,
} from '../../../lib/capture/voice/permissions.ts';
import {
  DEFAULT_MAX_MS,
  formatElapsed,
  startRecording,
  type Recording,
  type VoiceRecorder,
} from '../../../lib/capture/voice/recorder.ts';
import { saveRecording } from '../../../lib/capture/voice/queue.ts';
import { getDeviceKey } from '../../../lib/pwa/outbox/crypto.ts';
import { dexieKeyStore, dexieOutboxStore } from '../../../lib/pwa/outbox/db.ts';
import { OutboxCapError } from '../../../lib/pwa/outbox/queue.ts';

import { HoldToTalkButton } from './hold-to-talk-button.tsx';
import { RecordingReview } from './recording-review.tsx';
import { VoiceDenied, VoiceOnboardingNote } from './voice-onboarding-note.tsx';
import { Waveform } from './waveform.tsx';

type Phase = 'ready' | 'recording' | 'review' | 'saved' | 'denied' | 'unavailable';

const BARS = 32;
const ONBOARDED_KEY = 'causedeck.voice.onboarded';
/** A microphone prompt takes longer than this; the release that came during it is not a hold. */
const PROMPT_MS = 400;

export interface VoiceRecorderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** The matter or listing the sheet was opened from. */
  matterHintId?: string | undefined;
  /** Longest recording in ms (5 minutes by default). */
  maxMs?: number | undefined;
  /** Called once a recording is stored on the device. */
  onSaved?: (() => void) | undefined;
}

export function VoiceRecorderSheet({
  open,
  onOpenChange,
  workspaceId,
  matterHintId,
  maxMs = DEFAULT_MAX_MS,
  onSaved,
}: VoiceRecorderSheetProps) {
  const t = useTranslations('voice');
  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BARS }, () => 0));
  const [announce, setAnnounce] = useState('');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [matterId, setMatterId] = useState(matterHintId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const recorder = useRef<VoiceRecorder | null>(null);
  const starting = useRef(false);
  const stopWhenReady = useRef(false);
  const releasedEarly = () => stopWhenReady.current;

  useEffect(() => {
    setOnboarded(window.localStorage.getItem(ONBOARDED_KEY) === '1');
  }, []);
  useEffect(() => {
    setMatterId(matterHintId);
  }, [matterHintId]);

  const release = useCallback(() => {
    recorder.current?.cancel();
    recorder.current = null;
  }, []);

  // Closing the sheet (or leaving the page) stops and drops any recording in progress.
  useEffect(() => release, [release]);
  useEffect(() => {
    if (!open) release();
  }, [open, release]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden' && recorder.current !== null) void finish();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );

  const reset = () => {
    setUrl(null);
    setRecording(null);
    setElapsed(0);
    setLevels(Array.from({ length: BARS }, () => 0));
    setError(null);
    setPhase('ready');
  };

  const finish = async () => {
    const active = recorder.current;
    if (active === null) return;
    recorder.current = null;
    const result = await active.stop();
    if (result === null) {
      setAnnounce(t('record.cancelled'));
      reset();
      return;
    }
    setAnnounce(t('record.stopped', { time: formatElapsed(result.durationMs) }));
    setRecording(result);
    setUrl(URL.createObjectURL(result.blob));
    setPhase('review');
  };

  const begin = async () => {
    if (starting.current || recorder.current !== null) return;
    starting.current = true;
    stopWhenReady.current = false;
    setError(null);
    const began = Date.now();
    let started: MicrophoneStart;
    try {
      started = await startMicrophone();
    } finally {
      starting.current = false;
    }
    if (started.kind !== 'stream') {
      setPhase(started.kind === 'error' ? 'ready' : started.kind);
      if (started.kind === 'error') setError(t('errors.record'));
      return;
    }
    try {
      recorder.current = startRecording({
        stream: started.stream,
        maxMs,
        onTick: (ms, level) => {
          setElapsed(ms);
          setLevels((previous) => [...previous.slice(1), level]);
        },
        onLimit: () => {
          setAnnounce(t('record.limit', { minutes: Math.round(maxMs / 60000) }));
          void finish();
        },
      });
    } catch {
      stopMicrophone(started.stream);
      setError(t('errors.record'));
      return;
    }
    window.localStorage.setItem(ONBOARDED_KEY, '1');
    setOnboarded(true);
    setPhase('recording');
    setAnnounce(t('record.elapsed', { time: formatElapsed(0) }));
    // A hold released before the microphone was ready ends the recording; after a permission
    // prompt it does not: the person is left in tap-to-stop mode.
    if (releasedEarly() && Date.now() - began < PROMPT_MS) void finish();
  };

  // "Recording, 00:12", read out about every 10 s (not every tick).
  useEffect(() => {
    if (phase === 'recording' && elapsed > 0 && Math.floor(elapsed / 1000) % 10 === 0) {
      setAnnounce(t('record.elapsed', { time: formatElapsed(elapsed) }));
    }
  }, [phase, elapsed, t]);

  const save = async () => {
    if (recording === null) return;
    setBusy(true);
    setError(null);
    try {
      const store = dexieOutboxStore();
      const key = await getDeviceKey(dexieKeyStore());
      await saveRecording(store, key, recording, { workspaceId, matterHintId: matterId });
      const offline = !navigator.onLine;
      setWasOffline(offline);
      if (!offline) {
        const { syncOutbox } = await import('../../../lib/pwa/outbox/sync.ts');
        void syncOutbox().catch(() => undefined);
      }
      onSaved?.();
      setUrl(null);
      setRecording(null);
      setPhase('saved');
    } catch (cause) {
      setError(cause instanceof OutboxCapError ? t('errors.full') : t('errors.save'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    release();
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) release();
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        data-slot="voice-sheet"
        className="max-h-dvh overflow-y-auto p-0 md:mx-auto md:max-w-[480px] xl:right-6 xl:bottom-6 xl:left-auto xl:max-w-sm xl:rounded-lg"
      >
        <SheetHeader className="p-4 pb-0">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <p role="status" aria-live="polite" className="sr-only" data-slot="voice-announce">
          {announce}
        </p>
        {error === null ? null : (
          <Alert tone="danger" className="m-4" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {phase === 'ready' || phase === 'recording' ? (
          <div className="flex flex-col items-center gap-4 p-4" data-slot="voice-record">
            {onboarded ? null : <VoiceOnboardingNote />}
            <Waveform levels={levels} label={t('record.waveform')} />
            <span aria-hidden="true" className="text-ink text-2xl tabular-nums">
              {formatElapsed(elapsed)}
            </span>
            <HoldToTalkButton
              recording={phase === 'recording'}
              labels={{
                hold: t('record.hold'),
                stop: t('record.stop'),
                slideCancel: t('record.slideCancel'),
              }}
              onStart={() => void begin()}
              onStop={(reason) => {
                if (recorder.current === null) {
                  if (starting.current && reason === 'release') stopWhenReady.current = true;
                  return;
                }
                void finish();
              }}
              onCancel={() => {
                stopWhenReady.current = false;
                release();
                setAnnounce(t('record.cancelled'));
                reset();
              }}
            />
            <p className="text-ink-muted text-xs">{t('record.hint')}</p>
            <p className="text-ink-muted text-xs">{t('privacy')}</p>
          </div>
        ) : null}
        {phase === 'denied' || phase === 'unavailable' ? <VoiceDenied kind={phase} /> : null}
        {phase === 'review' && recording !== null && url !== null ? (
          <RecordingReview
            url={url}
            durationMs={recording.durationMs}
            matterId={matterId}
            onClearMatter={() => {
              setMatterId(undefined);
            }}
            busy={busy}
            onAgain={reset}
            onSave={() => void save()}
          />
        ) : null}
        {phase === 'saved' ? (
          <div className="flex flex-col gap-3 p-4" data-slot="voice-saved">
            <p role="status" className="text-ink text-sm">
              {wasOffline ? t('saved.offline') : t('saved.online')}
            </p>
            <Button className="min-h-11 self-start" onClick={close}>
              {t('close')}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Opens the recorder sheet when the URL says `?capture=voice` (the command palette's "Record a
 * voice note", the shell's Capture button) and drops the parameter when it closes. Mounted lazily
 * by the shell. `?matter=<id>` links the recording to that matter.
 */
export function VoiceHost({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const open = wantsVoice(params);
  useEffect(
    () => registerVoiceCommand(() => `${window.location.pathname}${window.location.search}`),
    [],
  );
  if (!open) return null;
  return (
    <VoiceRecorderSheet
      open
      workspaceId={workspaceId}
      matterHintId={matterFromSearch(params)}
      onOpenChange={(next) => {
        if (next) return;
        const rest = new URLSearchParams(params.toString());
        rest.delete(VOICE_QUERY_KEY);
        rest.delete(VOICE_MATTER_KEY);
        const query = rest.toString();
        router.replace(query === '' ? pathname : `${pathname}?${query}`);
      }}
    />
  );
}
