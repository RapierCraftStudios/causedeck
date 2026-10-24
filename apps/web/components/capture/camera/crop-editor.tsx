'use client';
// The four-corner crop (#52): 44 px handles over the photo, a magnifier loupe while dragging, and
// keyboard nudging (arrow keys 4 px, Shift 16 px). Corners are in source-image pixels. The suggested
// corners are only a start: "Use this crop" always works, and "Reset corners" restores them.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import type { Point, Quad } from '../../../lib/capture/camera/deskew.ts';

const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'] as const;
const NUDGE = 4;
const NUDGE_SHIFT = 16;
const LOUPE = 96;
const ZOOM = 3;

export interface CropEditorProps {
  src: string;
  width: number;
  height: number;
  corners: Quad;
  suggested: Quad;
  enhance: boolean;
  onEnhance: (enhance: boolean) => void;
  onChange: (corners: Quad) => void;
  onApply: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

export function CropEditor({
  src,
  width,
  height,
  corners,
  suggested,
  enhance,
  onEnhance,
  onChange,
  onApply,
  onCancel,
  busy = false,
}: CropEditorProps) {
  const t = useTranslations('camera');
  const frame = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const move = (index: number, point: Point) => {
    const next = corners.map((corner, i) =>
      i === index ? { x: clamp(point.x, width), y: clamp(point.y, height) } : corner,
    );
    onChange(next as unknown as Quad);
  };

  const fromEvent = (event: PointerEvent): Point | null => {
    const rect = frame.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const onKeyDown = (index: number, event: KeyboardEvent) => {
    const step = event.shiftKey ? NUDGE_SHIFT : NUDGE;
    const rect = frame.current?.getBoundingClientRect();
    // Steps are screen pixels; convert to source pixels so 4 px feels the same on any photo.
    const scale = rect === undefined || rect.width === 0 ? 1 : width / rect.width;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (d === undefined) return;
    event.preventDefault();
    const corner = corners[index] as Point;
    move(index, { x: corner.x + d[0] * scale, y: corner.y + d[1] * scale });
  };

  const active = dragging === null ? null : (corners[dragging] as Point);
  return (
    <div data-slot="crop-editor" className="flex flex-col gap-3 p-4">
      <h2 className="text-ink font-serif text-lg">{t('crop.title')}</h2>
      <p className="text-ink-muted text-sm">{t('crop.hint')}</p>
      <div
        ref={frame}
        className="relative mx-auto w-full max-w-[560px] touch-none select-none"
        style={{ aspectRatio: `${String(width)} / ${String(height)}` }}
      >
        <img src={src} alt="" draggable={false} className="absolute inset-0 size-full" />
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          className="pointer-events-none absolute inset-0 size-full"
        >
          <polygon
            points={corners.map((p) => `${String(p.x)},${String(p.y)}`).join(' ')}
            fill="rgba(255,255,255,0.12)"
            stroke="white"
            strokeWidth={Math.max(2, width / 300)}
            style={{ paintOrder: 'stroke', filter: 'drop-shadow(0 0 2px black)' }}
          />
        </svg>
        {corners.map((corner, index) => (
          <button
            key={CORNER_KEYS[index]}
            type="button"
            role="slider"
            aria-label={t('crop.handle', {
              corner: t(`crop.corner.${CORNER_KEYS[index] ?? 'tl'}`),
            })}
            aria-valuetext={`${String(Math.round(corner.x))}, ${String(Math.round(corner.y))}`}
            aria-valuenow={Math.round(corner.x)}
            className="focus-visible:outline-ring absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-offset-2 focus-visible:outline-2 motion-safe:transition-transform motion-safe:duration-100"
            style={{
              left: `${String((corner.x / width) * 100)}%`,
              top: `${String((corner.y / height) * 100)}%`,
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(index);
            }}
            onPointerMove={(event) => {
              if (dragging !== index) return;
              const point = fromEvent(event);
              if (point !== null) move(index, point);
            }}
            onPointerUp={() => {
              setDragging(null);
            }}
            onKeyDown={(event) => {
              onKeyDown(index, event);
            }}
          >
            <span className="size-4 rounded-full border-2 border-white bg-black/60 shadow" />
          </button>
        ))}
        {active === null ? null : (
          <div
            aria-hidden="true"
            data-slot="crop-loupe"
            className="border-line pointer-events-none absolute top-2 left-2 overflow-hidden rounded-full border-2 bg-white"
            style={{
              width: LOUPE,
              height: LOUPE,
              backgroundImage: `url(${src})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${String(ZOOM * 100)}% ${String(ZOOM * 100)}%`,
              backgroundPosition: `${String((active.x / width) * 100 * (ZOOM / (ZOOM - 1)))}% ${String((active.y / height) * 100 * (ZOOM / (ZOOM - 1)))}%`,
            }}
          />
        )}
      </div>
      <label className="text-ink flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={enhance}
          onChange={(event) => {
            onEnhance(event.target.checked);
          }}
        />
        {t('crop.enhance')}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={busy} onClick={onApply}>
          {t('crop.apply')}
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => {
            onChange(suggested);
          }}
        >
          {t('crop.reset')}
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={onCancel}>
          {t('close')}
        </Button>
      </div>
    </div>
  );
}
