'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/button';
import { Input } from '../../components/input';
import { cn } from '../../lib/cn';

/** What the lawyer decided for a value that may never be filled in for them. */
export type Resolution =
  | { kind: 'unresolved' }
  | { kind: 'value'; value: string; source: 'proposal' | 'manual' }
  | { kind: 'none' }
  | { kind: 'deferred' };

export interface ResolutionFieldLabels {
  legend: string;
  /** The proposed value, to confirm with one action. */
  useProposed: (value: string) => string;
  typed: string;
  typedHint: string;
  none: string;
  deferred: string;
  required: string;
}

export const DEFAULT_RESOLUTION_FIELD_LABELS: ResolutionFieldLabels = {
  legend: 'Next date',
  useProposed: (value) => `Confirm ${value}`,
  typed: 'Enter a date',
  typedHint: 'dd/mm/yyyy',
  none: 'No next date / disposed',
  deferred: 'To be notified',
  required: 'Choose one to continue.',
};

export interface ResolutionFieldProps extends Omit<ComponentProps<'fieldset'>, 'onChange'> {
  /** The proposed value as displayed, with its provenance chip in `source`; absent when unanchored. */
  proposed?: string | undefined;
  source?: ReactNode;
  resolution: Resolution;
  onResolve: (next: Resolution) => void;
  /** The typed text (dd/mm/yyyy) and what is wrong with it. */
  typedText?: string | undefined;
  onTypedText?: ((text: string) => void) | undefined;
  typedError?: string | undefined;
  disabled?: boolean | undefined;
  labels?: Partial<ResolutionFieldLabels> | undefined;
}

/**
 * A value that needs a human action even when proposed with high confidence: confirm the proposal,
 * type one, or mark it none or deferred. Nothing is pre-selected.
 */
export function ResolutionField({
  proposed,
  source,
  resolution,
  onResolve,
  typedText = '',
  onTypedText,
  typedError,
  disabled = false,
  labels,
  className,
  ...props
}: ResolutionFieldProps) {
  const text = { ...DEFAULT_RESOLUTION_FIELD_LABELS, ...labels };
  const hintId = useId();
  const errorId = useId();
  const pressed = (kind: Resolution['kind'], manual?: boolean) =>
    resolution.kind === kind &&
    (kind !== 'value' || (resolution.kind === 'value' && (resolution.source === 'manual') === !!manual));
  return (
    <fieldset
      data-slot="resolution-field"
      disabled={disabled}
      className={cn('grid gap-3 border-0 p-0', className)}
      {...props}
    >
      <legend className="mb-2 text-sm font-medium">{text.legend}</legend>
      {proposed === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={pressed('value') ? 'default' : 'outline'}
            aria-pressed={pressed('value')}
            onClick={() => {
              onResolve({ kind: 'value', value: proposed, source: 'proposal' });
            }}
          >
            {text.useProposed(proposed)}
          </Button>
          {source}
        </div>
      )}
      <div className="grid gap-1">
        <label htmlFor={hintId} className="text-sm">
          {text.typed}
        </label>
        <Input
          id={hintId}
          inputMode="numeric"
          autoComplete="off"
          placeholder={text.typedHint}
          value={typedText}
          aria-invalid={typedError === undefined ? undefined : true}
          aria-describedby={typedError === undefined ? undefined : errorId}
          onChange={(event) => onTypedText?.(event.currentTarget.value)}
        />
        {typedError === undefined ? null : (
          <p id={errorId} role="alert" className="text-destructive text-sm">
            {typedError}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={pressed('none') ? 'default' : 'outline'}
          aria-pressed={pressed('none')}
          onClick={() => {
            onResolve({ kind: 'none' });
          }}
        >
          {text.none}
        </Button>
        <Button
          type="button"
          variant={pressed('deferred') ? 'default' : 'outline'}
          aria-pressed={pressed('deferred')}
          onClick={() => {
            onResolve({ kind: 'deferred' });
          }}
        >
          {text.deferred}
        </Button>
      </div>
      {resolution.kind === 'unresolved' ? (
        <p data-slot="resolution-required" className="text-muted-foreground text-sm">
          {text.required}
        </p>
      ) : null}
    </fieldset>
  );
}
