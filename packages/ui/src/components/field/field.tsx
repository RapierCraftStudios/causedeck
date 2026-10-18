'use client';

import { CircleAlert } from 'lucide-react';
import {
  createContext,
  useContext,
  useId,
  type AriaAttributes,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Label, type LabelLabels } from '../label/label';

/** Ids and state a `Field` shares with the control inside it. */
export interface FieldContextValue {
  controlId: string;
  labelId: string;
  hintId: string | undefined;
  errorId: string | undefined;
  invalid: boolean;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding `Field`'s ids and state, or `null` outside a field. */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** Props a control accepts that a surrounding `Field` can supply. Explicit props win. */
export interface FieldControlInput {
  id?: string | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  required?: boolean | undefined;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  'aria-describedby'?: string | undefined;
  'aria-labelledby'?: string | undefined;
}

export interface FieldControl {
  id: string | undefined;
  labelId: string | undefined;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
  invalid: boolean;
  /** Spread onto the element that carries the control's role. */
  ariaProps: {
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
    'aria-required': true | undefined;
  };
}

const joinIds = (...ids: (string | undefined)[]): string | undefined => {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
};

/**
 * Wire a control to its `Field`: id (for the label), `aria-invalid`, `aria-describedby` (hint and
 * error, only when rendered, plus any caller ids) and `aria-required`. Works standalone too.
 */
export function useFieldControl(props: FieldControlInput): FieldControl {
  const field = useFieldContext();
  const ariaInvalid = props['aria-invalid'];
  const invalid =
    ariaInvalid === undefined
      ? (field?.invalid ?? false)
      : ariaInvalid !== false && ariaInvalid !== 'false';
  const required = props.required ?? field?.required ?? false;
  return {
    id: props.id ?? field?.controlId,
    labelId: field?.labelId,
    disabled: props.disabled ?? field?.disabled ?? false,
    readOnly: props.readOnly ?? field?.readOnly ?? false,
    required,
    invalid,
    ariaProps: {
      'aria-invalid': invalid || undefined,
      'aria-describedby': joinIds(field?.hintId, field?.errorId, props['aria-describedby']),
      'aria-required': required || undefined,
    },
  };
}

export type FieldLabels = LabelLabels;

export interface FieldProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The control's label. */
  label: ReactNode;
  /** Help text below the control, linked with `aria-describedby`. */
  hint?: ReactNode | undefined;
  /** Error message below the control (with an icon); also marks the control invalid. */
  error?: ReactNode | undefined;
  /** Mark the control invalid without a message (prefer passing `error`). */
  invalid?: boolean | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  /** Id for the control; generated when omitted. */
  controlId?: string | undefined;
  /** `vertical`: label above the control. `horizontal`: control then label (checkbox, switch). */
  orientation?: 'vertical' | 'horizontal' | undefined;
  labels?: Partial<FieldLabels> | undefined;
  /** The control: Input, Textarea, Select, Combobox, Checkbox, RadioGroup, Switch, Slider, ... */
  children: ReactNode;
}

/** Label + control + hint + error, with generated ids wired into the control. */
export function Field({
  label,
  hint,
  error,
  invalid,
  required = false,
  disabled = false,
  readOnly = false,
  controlId,
  orientation = 'vertical',
  labels,
  className,
  children,
  ...props
}: FieldProps) {
  const baseId = useId();
  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const context: FieldContextValue = {
    controlId: controlId ?? `${baseId}-control`,
    labelId: `${baseId}-label`,
    hintId: hasHint ? `${baseId}-hint` : undefined,
    errorId: hasError ? `${baseId}-error` : undefined,
    invalid: invalid ?? hasError,
    disabled,
    readOnly,
    required,
  };

  const labelNode = (
    <Label id={context.labelId} htmlFor={context.controlId} required={required} labels={labels}>
      {label}
    </Label>
  );

  return (
    <FieldContext.Provider value={context}>
      <div
        data-slot="field"
        data-orientation={orientation}
        data-invalid={context.invalid ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        className={cn('group/field flex min-w-0 flex-col gap-1.5', className)}
        {...props}
      >
        {orientation === 'horizontal' ? (
          <div className="flex items-start gap-2.5 [&>[data-slot=label]]:pt-px">
            {children}
            {labelNode}
          </div>
        ) : (
          <>
            {labelNode}
            {children}
          </>
        )}
        {hasHint ? <FieldHint id={context.hintId}>{hint}</FieldHint> : null}
        {hasError ? <FieldError id={context.errorId}>{error}</FieldError> : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Help text under a control. `Field` renders it from its `hint` prop. */
export function FieldHint({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p data-slot="field-hint" className={cn('text-ink-muted text-sm', className)} {...props} />
  );
}

/** Error message under a control: icon plus text, never colour alone. */
export function FieldError({ className, children, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-error"
      className={cn('text-danger flex items-start gap-1.5 text-sm', className)}
      {...props}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
