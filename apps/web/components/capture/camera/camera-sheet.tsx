'use client';
// The camera sheet (#52): the rear camera with a page guide, four-corner crop, multi-page batches
// and review. Camera permission is asked for only when the sheet opens and the stream stops when it
// closes. Every page is written to the encrypted outbox the moment it is taken (held back from
// upload), so a tab crash loses nothing; "Upload" finishes the batch into one multi-page item.
// Where `getUserMedia` is unavailable or denied the gallery picker (and the `capture="environment"`
// file input) stand in, so the sheet always works from a keyboard on a desktop.
import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
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
  CAMERA_QUERY_KEY,
  registerCameraCommand,
  wantsCamera,
} from '../../../lib/capture/camera/command-registration.ts';
import { grabFrame, startCamera, stopCamera } from '../../../lib/capture/camera/capture.ts';
import { defaultCorners, suggestCorners, type Quad } from '../../../lib/capture/camera/deskew.ts';
import { hintFor, processImage, toGray } from '../../../lib/capture/camera/process-image.ts';
import {
  deletePage,
  discardSession,
  finishBatch,
  recoverSessions,
  reorderPages,
  savePage,
  type RecoverableSession,
  type SessionOptions,
} from '../../../lib/capture/camera/queue.ts';
import { getDeviceKey } from '../../../lib/pwa/outbox/crypto.ts';
import { dexieKeyStore, dexieOutboxStore } from '../../../lib/pwa/outbox/db.ts';

import { CameraViewfinder } from './camera-viewfinder.tsx';
import { CropEditor } from './crop-editor.tsx';
import { PageStrip, type StripPage } from './page-strip.tsx';
import { PhotoReview } from './photo-review.tsx';

type Phase = 'starting' | 'recover' | 'camera' | 'denied' | 'crop' | 'review';

interface Pending {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  corners: Quad;
  suggested: Quad;
  /** Replace this page position instead of appending (Retake). */
  retake: number | null;
}

interface Page extends StripPage {
  index: number;
  original?: Blob | undefined;
}

export interface CameraSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  matterHintId?: string | undefined;
  /** Called once a batch is queued for upload. */
  onQueued?: ((pages: number) => void) | undefined;
}

async function measure(blob: Blob): Promise<{ width: number; height: number; suggested: Quad }> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const edge = 256;
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null)
      return {
        width: bitmap.width,
        height: bitmap.height,
        suggested: defaultCorners(bitmap.width, bitmap.height),
      };
    context.drawImage(bitmap, 0, 0, w, h);
    const small = suggestCorners(toGray(context.getImageData(0, 0, w, h).data), w, h);
    const up = 1 / scale;
    const suggested = small.map((p) => ({ x: p.x * up, y: p.y * up })) as unknown as Quad;
    return { width: bitmap.width, height: bitmap.height, suggested };
  } finally {
    bitmap.close();
  }
}

/** Camera permission denied or unavailable: how to enable it, with the gallery always offered. */
export function CameraDenied({
  count,
  onChoose,
  onReview,
}: {
  count: number;
  onChoose: () => void;
  onReview: () => void;
}) {
  const t = useTranslations('camera');
  return (
    <div className="flex flex-col gap-3 p-4" data-slot="camera-denied">
      <Alert>
        <AlertTitle>{t('denied.title')}</AlertTitle>
        <AlertDescription>{t('denied.steps')}</AlertDescription>
      </Alert>
      <p className="text-ink text-sm">{t('denied.body')}</p>
      <p className="text-ink-muted text-xs">{t('privacy')}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={onChoose}>
          {t('choose')}
        </Button>
        {count > 0 ? (
          <Button variant="secondary" className="min-h-11" onClick={onReview}>
            {t('done', { count })}
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {t('captured', { count })}
      </p>
    </div>
  );
}

export function CameraSheet({
  open,
  onOpenChange,
  workspaceId,
  matterHintId,
  onQueued,
}: CameraSheetProps) {
  const t = useTranslations('camera');
  const [phase, setPhase] = useState<Phase>('starting');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [queue, setQueue] = useState<Blob[]>([]);
  const [enhance, setEnhance] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [hint, setHint] = useState<'blurry' | 'glare' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [recoverable, setRecoverable] = useState<RecoverableSession | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const batchId = useRef<string>('');
  const nextIndex = useRef(1);
  const pendingRetake = useRef<number | null>(null);

  const session = useCallback(
    (): SessionOptions => ({ batchId: batchId.current, workspaceId, matterHintId }),
    [workspaceId, matterHintId],
  );

  const releaseStream = useCallback(() => {
    setStream((current) => {
      stopCamera(current);
      return null;
    });
  }, []);

  const openCamera = useCallback(async () => {
    setPhase('starting');
    const started = await startCamera();
    if (started.kind === 'stream') {
      setStream(started.stream);
      setPhase('camera');
    } else if (started.kind === 'denied') {
      setPhase('denied');
    } else {
      setError(t('errors.open'));
      setPhase('denied');
    }
  }, [t]);

  // Open: look for a crashed session first; otherwise ask for the camera. Close: stop everything.
  useEffect(() => {
    if (!open) return undefined;
    const run = { cancelled: false };
    batchId.current = crypto.randomUUID();
    nextIndex.current = 1;
    setPages([]);
    setError(null);
    setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
    void (async () => {
      const sessions = await recoverSessions(dexieOutboxStore()).catch(() => []);
      if (run.cancelled) return;
      const mine = sessions.find((s) => s.workspaceId === workspaceId) ?? null;
      if (mine !== null) {
        setRecoverable(mine);
        setPhase('recover');
      } else {
        await openCamera();
      }
    })();
    return () => {
      run.cancelled = true;
      releaseStream();
    };
  }, [open, workspaceId, openCamera, releaseStream]);

  const pagesFromSession = async (recovered: RecoverableSession) => {
    const key = await getDeviceKey(dexieKeyStore());
    const { decryptBytes } = await import('../../../lib/pwa/outbox/crypto.ts');
    const restored: Page[] = [];
    for (const [position, item] of recovered.pages.entries()) {
      const bytes = await decryptBytes(key, item);
      restored.push({
        id: position + 1,
        index: position + 1,
        url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })),
      });
    }
    batchId.current = recovered.batchId;
    nextIndex.current = restored.length + 1;
    setPages(restored);
  };

  const beginCrop = async (blob: Blob, retake: number | null) => {
    try {
      const { width, height, suggested } = await measure(blob);
      setPending({
        blob,
        url: URL.createObjectURL(blob),
        width,
        height,
        corners: suggested,
        suggested,
        retake,
      });
      setPhase('crop');
    } catch {
      setError(t('errors.process'));
    }
  };

  // Gallery photos wait their turn through the crop editor, one at a time.
  useEffect(() => {
    if (pending !== null || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    if (next !== undefined) void beginCrop(next, null);
  }, [pending, queue]);

  const shutter = async () => {
    const element = video.current;
    if (element === null) return;
    setBusy(true);
    try {
      await beginCrop(await grabFrame(element), null);
    } catch {
      setError(t('errors.process'));
    } finally {
      setBusy(false);
    }
  };

  const applyCrop = async () => {
    if (pending === null) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await processImage(pending.blob, { corners: pending.corners, enhance });
      setHint(hintFor(photo.quality));
      const store = dexieOutboxStore();
      const key = await getDeviceKey(dexieKeyStore());
      const at = pending.retake;
      const index = at === null ? nextIndex.current : (pages[at]?.index ?? nextIndex.current);
      if (at !== null) await deletePage(store, session(), index);
      if (at === null) nextIndex.current += 1;
      await savePage(store, key, session(), {
        index,
        photo: photo.blob,
        original: keepOriginal ? pending.blob : undefined,
      });
      const page: Page = { id: index, index, url: URL.createObjectURL(photo.blob) };
      setPages((current) =>
        at === null ? [...current, page] : current.map((p, i) => (i === at ? page : p)),
      );
      URL.revokeObjectURL(pending.url);
      setPending(null);
      setPhase(stream === null ? 'denied' : 'camera');
    } catch {
      setError(t('errors.save'));
    } finally {
      setBusy(false);
    }
  };

  const cancelCrop = () => {
    if (pending !== null) URL.revokeObjectURL(pending.url);
    setPending(null);
    setPhase(stream === null ? 'denied' : 'camera');
  };

  const move = async (from: number, to: number) => {
    const order = pages.map((p) => p.index);
    const [moved] = order.splice(from, 1);
    if (moved === undefined) return;
    order.splice(to, 0, moved);
    await reorderPages(dexieOutboxStore(), session(), order);
    // The names now carry the new order: renumber the pages to match.
    const byIndex = new Map(pages.map((p) => [p.index, p]));
    const next = order.map((index, position) => ({
      ...(byIndex.get(index) as Page),
      index: position + 1,
    }));
    nextIndex.current = next.length + 1;
    setPages(next);
  };

  const remove = async (position: number) => {
    const page = pages[position];
    if (page === undefined) return;
    await deletePage(dexieOutboxStore(), session(), page.index);
    URL.revokeObjectURL(page.url);
    setPages(pages.filter((_, i) => i !== position));
  };

  const retake = (position: number) => {
    if (stream === null) {
      picker.current?.click();
      pendingRetake.current = position;
    } else {
      pendingRetake.current = position;
      void (async () => {
        if (video.current === null) return;
        setPhase('camera');
        await new Promise((resolve) => setTimeout(resolve, 0));
        const element = video.current as HTMLVideoElement | null;
        if (element !== null) await beginCrop(await grabFrame(element), position);
      })();
    }
  };

  const upload = async () => {
    setBusy(true);
    try {
      const store = dexieOutboxStore();
      const key = await getDeviceKey(dexieKeyStore());
      await finishBatch(store, key, session(), { keepOriginals: keepOriginal });
      const { syncOutbox } = await import('../../../lib/pwa/outbox/sync.ts');
      void syncOutbox().catch(() => undefined);
      onQueued?.(pages.length);
      for (const p of pages) URL.revokeObjectURL(p.url);
      setPages([]);
      onOpenChange(false);
    } catch {
      setError(t('errors.save'));
    } finally {
      setBusy(false);
    }
  };

  const discardAll = async () => {
    await discardSession(dexieOutboxStore(), batchId.current);
    for (const p of pages) URL.revokeObjectURL(p.url);
    setPages([]);
    onOpenChange(false);
  };

  const onPick = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    const at = pendingRetake.current;
    pendingRetake.current = null;
    if (at !== null && list[0] !== undefined) {
      void beginCrop(list[0], at);
      return;
    }
    setQueue((current) => [...current, ...list]);
  };

  const flashSupported = false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-slot="camera-sheet"
        className="max-h-dvh overflow-y-auto p-0 md:mx-auto md:max-w-[720px]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          data-slot="camera-file-input"
          onChange={(event) => {
            onPick(event.target.files);
            event.target.value = '';
          }}
        />
        {error === null ? null : (
          <Alert tone="danger" className="m-4" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {phase === 'recover' && recoverable !== null ? (
          <div className="flex flex-col gap-3 p-4" data-slot="camera-recover">
            <h2 className="text-ink font-serif text-lg">{t('recover.title')}</h2>
            <p className="text-ink text-sm">
              {t('recover.body', { count: recoverable.pages.length })}
            </p>
            <div className="flex gap-2">
              <Button
                className="min-h-11"
                onClick={() => {
                  void pagesFromSession(recoverable).then(() => {
                    setRecoverable(null);
                    setPhase('review');
                  });
                }}
              >
                {t('recover.resume')}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  void discardSession(dexieOutboxStore(), recoverable.batchId).then(() => {
                    setRecoverable(null);
                    void openCamera();
                  });
                }}
              >
                {t('recover.discard')}
              </Button>
            </div>
          </div>
        ) : null}
        {phase === 'starting' || phase === 'camera' ? (
          <>
            <CameraViewfinder
              stream={stream}
              videoRef={video}
              count={pages.length}
              hint={hint}
              strip={<PageStrip pages={pages} compact />}
              flashSupported={flashSupported}
              flashOn={flashOn}
              onFlash={() => {
                setFlashOn((on) => !on);
              }}
              onShutter={() => void shutter()}
              onDone={() => {
                setPhase('review');
              }}
              onClose={() => {
                onOpenChange(false);
              }}
              busy={busy}
            />
            <div className="flex flex-col gap-2 p-3">
              <p className="text-ink-muted text-xs">{t('privacy')}</p>
              <Button
                variant="secondary"
                className="min-h-11 self-start"
                onClick={() => picker.current?.click()}
              >
                {t('choose')}
              </Button>
            </div>
          </>
        ) : null}
        {phase === 'denied' ? (
          <CameraDenied
            count={pages.length}
            onChoose={() => picker.current?.click()}
            onReview={() => {
              setPhase('review');
            }}
          />
        ) : null}
        {phase === 'crop' && pending !== null ? (
          <CropEditor
            src={pending.url}
            width={pending.width}
            height={pending.height}
            corners={pending.corners}
            suggested={pending.suggested}
            enhance={enhance}
            onEnhance={setEnhance}
            onChange={(corners) => {
              setPending({ ...pending, corners });
            }}
            onApply={() => void applyCrop()}
            onCancel={cancelCrop}
            busy={busy}
          />
        ) : null}
        {phase === 'review' ? (
          <PhotoReview
            pages={pages}
            keepOriginal={keepOriginal}
            onKeepOriginal={setKeepOriginal}
            offline={offline}
            busy={busy}
            onMove={(from, to) => void move(from, to)}
            onRetake={retake}
            onDelete={(position) => void remove(position)}
            onUpload={() => void upload()}
            onBack={() => {
              if (stream === null) void openCamera();
              else setPhase('camera');
            }}
            onDiscard={() => void discardAll()}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Opens the camera sheet when the URL says `?capture=camera` (the command palette's "Photograph a
 * diary page") and drops the parameter when it closes. Mounted lazily by the shell.
 */
export function CameraHost({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const open = wantsCamera(params);
  useEffect(
    () => registerCameraCommand(() => `${window.location.pathname}${window.location.search}`),
    [],
  );
  if (!open) return null;
  return (
    <CameraSheet
      open
      workspaceId={workspaceId}
      onOpenChange={(next) => {
        if (next) return;
        const rest = new URLSearchParams(params.toString());
        rest.delete(CAMERA_QUERY_KEY);
        const query = rest.toString();
        router.replace(query === '' ? pathname : `${pathname}?${query}`);
      }}
    />
  );
}
