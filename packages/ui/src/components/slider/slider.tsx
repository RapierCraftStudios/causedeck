'use client';

import { Slider as SliderPrimitive } from 'radix-ui';
import { useId, useState, type ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';

export interface SliderLabels {
  /** Names of the two thumbs of a range slider (appended to the field label). */
  minimum: string;
  maximum: string;
}

export const DEFAULT_SLIDER_LABELS: SliderLabels = { minimum: 'Minimum', maximum: 'Maximum' };

export interface SliderProps extends Omit<ComponentProps<typeof SliderPrimitive.Root>, 'id'> {
  /** Id of the first thumb (the element labelled by a `Field`). */
  id?: string;
  /** Show the value but ignore pointer and keys; thumbs stay focusable. */
  readOnly?: boolean | undefined;
  labels?: Partial<SliderLabels> | undefined;
}

/** Pick a number (one thumb) or a range (two thumbs) on a track. */
export function Slider({
  className,
  readOnly,
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  labels,
  ...props
}: SliderProps) {
  const control = useFieldControl({ ...props, readOnly });
  const thumbIds = useId();
  const text = { ...DEFAULT_SLIDER_LABELS, ...labels };
  const [inner, setInner] = useState<number[]>(defaultValue ?? [min]);
  const current = value ?? inner;
  const range = current.length > 1;
  // The thumbs carry the ARIA state; the root is a plain container.
  const rootProps = { ...props };
  delete rootProps['aria-describedby'];
  delete rootProps['aria-invalid'];

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      {...rootProps}
      min={min}
      max={max}
      value={current}
      onValueChange={(next) => {
        if (control.readOnly) return;
        setInner(next);
        onValueChange?.(next);
      }}
      disabled={control.disabled}
      data-readonly={control.readOnly ? '' : undefined}
      data-invalid={control.invalid ? '' : undefined}
      className={cn(
        'relative flex w-full touch-none items-center select-none',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'data-[orientation=horizontal]:h-5 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-5 data-[orientation=vertical]:flex-col',
        className,
      )}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-line-strong relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-accent absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full forced-colors:bg-current"
        />
      </SliderPrimitive.Track>
      {current.map((_, index) => {
        const nameId = `${thumbIds}-thumb-${String(index)}`;
        return (
          <SliderPrimitive.Thumb
            // Thumbs are positional, so the index is their identity.
            key={index}
            data-slot="slider-thumb"
            id={index === 0 ? control.id : undefined}
            {...control.ariaProps}
            aria-required={undefined}
            aria-readonly={control.readOnly || undefined}
            aria-labelledby={
              range
                ? [control.labelId, nameId].filter(Boolean).join(' ')
                : (props['aria-labelledby'] ?? control.labelId)
            }
            aria-label={
              control.labelId || props['aria-labelledby'] ? undefined : props['aria-label']
            }
            className={cn(
              'border-accent bg-surface-raised shadow-1 relative block size-4 shrink-0 rounded-full border-2',
              'ease-standard transition-colors duration-(--dur-fast) motion-reduce:transition-none',
              'hover:bg-accent-soft',
              'focus-visible:outline-ring outline-offset-2 focus-visible:outline-2',
              'aria-invalid:border-danger',
              'data-disabled:cursor-not-allowed',
              'pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5',
              'forced-colors:border-current',
            )}
          >
            {range ? (
              <span id={nameId} className="sr-only">
                {index === 0 ? text.minimum : text.maximum}
              </span>
            ) : null}
          </SliderPrimitive.Thumb>
        );
      })}
    </SliderPrimitive.Root>
  );
}
