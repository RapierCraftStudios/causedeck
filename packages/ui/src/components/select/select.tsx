'use client';

import { Check, ChevronDown, CircleAlert } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';
import { controlClasses, controlHeight } from '../input/input';
import { Spinner } from '../spinner/spinner';

export interface SelectLabels {
  /** Announced while `loading`. */
  loading: string;
}

export const DEFAULT_SELECT_LABELS: SelectLabels = { loading: 'Loading' };

interface SelectState {
  readOnly: boolean;
}

const SelectContext = createContext<SelectState>({ readOnly: false });

export interface SelectProps extends ComponentProps<typeof SelectPrimitive.Root> {
  /** Show the value but do not open; the trigger stays focusable. */
  readOnly?: boolean | undefined;
}

/** Choose one value from a short list. Compose with SelectTrigger, SelectContent, SelectItem. */
export function Select({
  readOnly,
  disabled,
  required,
  open,
  onOpenChange,
  ...props
}: SelectProps) {
  const control = useFieldControl({ readOnly, disabled, required });
  return (
    <SelectContext.Provider value={{ readOnly: control.readOnly }}>
      <SelectPrimitive.Root
        data-slot="select"
        disabled={control.disabled}
        required={control.required}
        open={control.readOnly ? false : open}
        onOpenChange={control.readOnly ? undefined : onOpenChange}
        {...props}
      />
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps extends ComponentProps<typeof SelectPrimitive.Trigger> {
  /** Decorative icon before the value. */
  icon?: ReactNode | undefined;
  /** Show a spinner, mark `aria-busy` and block opening (options are still loading). */
  loading?: boolean | undefined;
  labels?: Partial<SelectLabels> | undefined;
}

/** The 36 px button showing the current value; wires itself to a surrounding `Field`. */
export function SelectTrigger({
  icon,
  loading = false,
  labels,
  className,
  children,
  ...props
}: SelectTriggerProps) {
  const control = useFieldControl(props);
  const { readOnly } = useContext(SelectContext);
  const text = { ...DEFAULT_SELECT_LABELS, ...labels };
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      {...props}
      {...control.ariaProps}
      id={control.id}
      disabled={control.disabled || loading}
      aria-busy={loading || undefined}
      aria-readonly={readOnly || undefined}
      data-readonly={readOnly ? '' : undefined}
      className={cn(
        controlClasses,
        controlHeight,
        'flex items-center justify-between gap-2 text-start whitespace-nowrap',
        'data-placeholder:text-ink-subtle [&>span]:truncate',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-ink-muted inline-flex">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      {loading ? (
        <Spinner size="md" labels={{ loading: text.loading }} />
      ) : control.invalid ? (
        <CircleAlert aria-hidden="true" className="text-danger" />
      ) : null}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden="true" className="text-ink-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

/** The floating list. Under reduced motion it appears instantly. */
export function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={position === 'popper' ? sideOffset : undefined}
        className={cn(
          'z-dropdown relative max-h-(--radix-select-content-available-height) min-w-32 overflow-x-hidden overflow-y-auto',
          'border-line bg-surface-overlay text-ink shadow-3 rounded-md border p-1',
          'motion-safe:data-[state=open]:animate-fade-in',
          position === 'popper' && 'w-full min-w-(--radix-select-trigger-width)',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 ps-8 pe-2',
        'font-sans text-sm outline-none select-none pointer-coarse:min-h-11',
        'data-highlighted:bg-accent-soft data-highlighted:text-ink',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <span className="absolute start-2 inline-flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectGroup(props: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('text-ink-muted px-2 py-1.5 text-xs font-medium', className)}
      {...props}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('bg-line -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}
