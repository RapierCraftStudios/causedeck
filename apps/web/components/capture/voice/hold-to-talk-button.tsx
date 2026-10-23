'use client';
// Press-and-hold to record (#543): release stops, a short tap toggles (start, then tap again to
// stop), sliding left cancels, and Space or Enter toggles for keyboards and switch users.
import { Mic, Square } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** A press at least this long is a hold; shorter is a tap that leaves recording on. */
export const HOLD_MS = 500;
/** Sliding left this far (px) cancels. */
export const CANCEL_DISTANCE = 80;

export interface HoldToTalkButtonProps {
  recording: boolean;
  disabled?: boolean | undefined;
  labels: { hold: string; stop: string; slideCancel: string };
  onStart: () => void;
  /** `release` ends a hold; `toggle` is a tap or key press while recording. */
  onStop: (reason: 'release' | 'toggle') => void;
  onCancel: () => void;
}

export function HoldToTalkButton({
  recording,
  disabled,
  labels,
  onStart,
  onStop,
  onCancel,
}: HoldToTalkButtonProps) {
  const press = useRef<{ at: number; x: number; stopOnly: boolean } | null>(null);
  const [slid, setSlid] = useState(false);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled === true || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { at: Date.now(), x: event.clientX, stopOnly: recording };
    if (recording) onStop('toggle');
    else onStart();
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (current === null || current.stopOnly) return;
    setSlid(current.x - event.clientX >= CANCEL_DISTANCE);
  };
  const up = () => {
    const current = press.current;
    press.current = null;
    const cancel = slid;
    setSlid(false);
    if (current === null || current.stopOnly) return;
    if (cancel) onCancel();
    else if (Date.now() - current.at >= HOLD_MS) onStop('release');
  };
  const abort = () => {
    const current = press.current;
    press.current = null;
    setSlid(false);
    if (current !== null && !current.stopOnly) onCancel();
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled === true || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    if (event.repeat) return;
    if (recording) onStop('toggle');
    else onStart();
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        data-slot="hold-to-talk"
        aria-pressed={recording}
        disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={abort}
        onKeyDown={key}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        className="bg-accent text-accent-ink focus-visible:outline-ring flex size-20 touch-none items-center justify-center rounded-full outline-offset-4 select-none focus-visible:outline-2 disabled:opacity-60"
      >
        {recording ? (
          <Square aria-hidden="true" className="size-8" />
        ) : (
          <Mic aria-hidden="true" className="size-8" />
        )}
        <span className="sr-only">{recording ? labels.stop : labels.hold}</span>
      </button>
      <span aria-hidden="true" className="text-ink-muted text-xs">
        {slid ? labels.slideCancel : recording ? labels.stop : labels.hold}
      </span>
    </div>
  );
}
