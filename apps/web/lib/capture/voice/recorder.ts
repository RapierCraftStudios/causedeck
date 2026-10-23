// The voice recorder (#543): format negotiation, a `MediaRecorder` wrapper with a time limit and
// level samples for the waveform, and the on-device date hint. Nothing here touches the network.
import { stopMicrophone } from './permissions.ts';

/** Default limit of one recording (configurable per recorder). */
export const DEFAULT_MAX_MS = 5 * 60 * 1000;

/** Preferred formats in order: Opus in WebM where supported, `audio/mp4` (Safari) otherwise. */
export const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;

type MimeSupport = { isTypeSupported(type: string): boolean };

/** The first preferred type the browser can record, or `undefined` to let it choose. */
export function pickMime(
  support: MimeSupport | undefined = typeof MediaRecorder === 'undefined'
    ? undefined
    : MediaRecorder,
): string | undefined {
  if (support === undefined) return undefined;
  return MIME_PREFERENCE.find((type) => support.isTypeSupported(type));
}

/** `audio/webm;codecs=opus` becomes `audio/webm`: the upload declares the bare type. */
export function baseMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

/** The file extension for a recorded type. */
export function extensionFor(mime: string): string {
  const base = baseMime(mime);
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  return 'webm';
}

/** `mm:ss` for an elapsed time, as read out to screen readers ("Recording, 00:12"). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface RecorderOptions {
  stream: MediaStream;
  maxMs?: number | undefined;
  mime?: string | undefined;
  /** Called about every 100 ms with the elapsed ms and a 0-1 input level. */
  onTick?: ((elapsedMs: number, level: number) => void) | undefined;
  /** Called when the limit stops the recording (the result is then available from `stop`). */
  onLimit?: (() => void) | undefined;
}

export interface Recording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export interface VoiceRecorder {
  /** Finish and return the recording; `null` when it was cancelled or empty. */
  stop(): Promise<Recording | null>;
  /** Throw the recording away. */
  cancel(): void;
}

/** Start recording `stream`. The stream is stopped when the recording ends either way. */
export function startRecording(options: RecorderOptions): VoiceRecorder {
  const { stream } = options;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const mime = options.mime ?? pickMime();
  const recorder = new MediaRecorder(stream, mime === undefined ? undefined : { mimeType: mime });
  const chunks: Blob[] = [];
  const started = Date.now();
  let cancelled = false;
  let finished: Promise<Recording | null> | null = null;

  let level = () => 0;
  let closeAudio: () => void = () => undefined;
  const AudioContextCtor = typeof AudioContext === 'undefined' ? undefined : AudioContext;
  if (AudioContextCtor !== undefined) {
    try {
      const audio = new AudioContextCtor();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      level = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        return Math.min(1, peak / 64);
      };
      closeAudio = () => void audio.close().catch(() => undefined);
    } catch {
      // No analyser: the waveform stays flat, the recording is unaffected.
    }
  }

  const timer = setInterval(() => {
    const elapsed = Date.now() - started;
    options.onTick?.(Math.min(elapsed, maxMs), level());
    if (elapsed >= maxMs && recorder.state === 'recording') {
      options.onLimit?.();
      recorder.stop();
    }
  }, 100);

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const done = new Promise<Recording | null>((resolve) => {
    recorder.addEventListener('stop', () => {
      clearInterval(timer);
      closeAudio();
      stopMicrophone(stream);
      const type = recorder.mimeType === '' ? (mime ?? 'audio/webm') : recorder.mimeType;
      if (cancelled || chunks.length === 0) resolve(null);
      else {
        resolve({
          blob: new Blob(chunks, { type }),
          mime: type,
          durationMs: Math.min(Date.now() - started, maxMs),
        });
      }
    });
  });
  recorder.start(1000);

  return {
    stop() {
      finished ??= done;
      if (recorder.state === 'recording') recorder.stop();
      return finished;
    },
    cancel() {
      cancelled = true;
      if (recorder.state === 'recording') recorder.stop();
    },
  };
}

const DATE_HINT = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/;

/**
 * A date written in free text (e.g. a typed note), as `14/11`. It is shown only as a hint ("date
 * mentioned: 14/11?") and never becomes a proposal: extraction runs on the server after upload.
 */
export function dateHint(text: string): string | null {
  const match = DATE_HINT.exec(text);
  if (match === null) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${String(day)}/${String(month).padStart(2, '0')}`;
}
