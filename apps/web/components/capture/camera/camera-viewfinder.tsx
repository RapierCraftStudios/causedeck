'use client';
// The live view (#52): a black surface in both themes, an A4 page guide with 8 px corner brackets
// (outlined dark so it shows on a bright page), the shutter (72 px) with the page strip to its left
// and "Done" to its right. Hints ("Glare on the page") go to a polite live region, one per 3 s.
import { Button } from '@causedeck/ui/button';
import { Spinner } from '@causedeck/ui/spinner';
import { Camera, X, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const HINT_INTERVAL_MS = 3000;

export interface CameraViewfinderProps {
  stream: MediaStream | null;
  /** The video element, for the parent to grab a frame from. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  count: number;
  hint: 'blurry' | 'glare' | null;
  /** The thumbnail strip, placed left of the shutter. */
  strip: ReactNode;
  flashSupported: boolean;
  flashOn: boolean;
  onFlash: () => void;
  onShutter: () => void;
  onDone: () => void;
  onClose: () => void;
  busy?: boolean;
}

/** Shows `hint` at most once per `HINT_INTERVAL_MS`, so the live region does not chatter. */
export function useRateLimitedHint(hint: 'blurry' | 'glare' | null): 'blurry' | 'glare' | null {
  const [shown, setShown] = useState<'blurry' | 'glare' | null>(null);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, last.current + HINT_INTERVAL_MS - Date.now());
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(hint);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [hint]);
  return shown;
}

function Bracket({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute size-8 border-white drop-shadow-[0_0_2px_rgba(0,0,0,0.9)] ${className}`}
    />
  );
}

export function CameraViewfinder({
  stream,
  videoRef,
  count,
  hint,
  strip,
  flashSupported,
  flashOn,
  onFlash,
  onShutter,
  onDone,
  onClose,
  busy = false,
}: CameraViewfinderProps) {
  const t = useTranslations('camera');
  const shownHint = useRateLimitedHint(hint);

  // The shutter waits for the stream's first decoded frame: before it the video is 0 x 0 and a
  // grab fails.
  const [framedStream, setFramedStream] = useState<MediaStream | null>(null);
  const frameReady = stream !== null && framedStream === stream;

  useEffect(() => {
    const video = videoRef.current;
    if (video !== null && stream !== null) video.srcObject = stream;
  }, [stream, videoRef]);

  return (
    <div
      data-slot="camera-viewfinder"
      className="relative flex h-full min-h-[70dvh] flex-col overflow-hidden bg-black text-white"
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
        <Button
          variant="ghost"
          size="lg"
          aria-label={t('close')}
          className="w-11 bg-black/50 px-0 text-white"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
        {flashSupported ? (
          <Button
            variant="ghost"
            size="lg"
            aria-label={t('flash')}
            aria-pressed={flashOn}
            className="w-11 bg-black/50 px-0 text-white"
            onClick={onFlash}
          >
            <Zap aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div className="relative flex-1">
        {stream === null ? (
          <div className="absolute inset-0 grid place-items-center" role="status">
            <Spinner />
            <span className="sr-only">{t('loading')}</span>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            data-slot="camera-video"
            onLoadedData={() => {
              setFramedStream(stream);
            }}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div className="relative aspect-[210/297] max-h-full w-full max-w-[min(100%,60vh)]">
            <Bracket className="top-0 left-0 rounded-tl-lg border-t-2 border-l-2" />
            <Bracket className="top-0 right-0 rounded-tr-lg border-t-2 border-r-2" />
            <Bracket className="right-0 bottom-0 rounded-br-lg border-r-2 border-b-2" />
            <Bracket className="bottom-0 left-0 rounded-bl-lg border-b-2 border-l-2" />
          </div>
        </div>
        <p
          className="absolute inset-x-0 bottom-2 text-center text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          data-slot="camera-guide"
        >
          {t('guide')}
        </p>
        <p role="status" aria-live="polite" className="absolute inset-x-0 top-16 text-center">
          {shownHint === null ? null : (
            <span className="rounded-full bg-black/70 px-3 py-1 text-sm">
              {t(`hints.${shownHint}`)}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 bg-black p-3">
        <div className="min-w-0 flex-1">{strip}</div>
        <button
          type="button"
          aria-label={t('shutter')}
          disabled={busy || stream === null || !frameReady}
          onClick={onShutter}
          className="grid size-[72px] shrink-0 place-items-center rounded-full border-4 border-white bg-white/20 text-white disabled:opacity-50 motion-safe:active:scale-95"
        >
          <Camera aria-hidden="true" className="size-7" />
        </button>
        <div className="flex flex-1 justify-end">
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={count === 0 || busy}
            onClick={onDone}
          >
            {t('done', { count })}
          </Button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {t('captured', { count })}
      </p>
    </div>
  );
}
