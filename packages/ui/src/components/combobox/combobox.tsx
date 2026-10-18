'use client';

import { Check, ChevronDown, CircleAlert } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type AriaAttributes,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';
import { controlClasses, controlHeight } from '../input/input';
import { Spinner } from '../spinner/spinner';

export interface ComboboxOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface ComboboxLabels {
  /** Shown when no option matches the typed text. */
  empty: string;
  /** Shown (and announced) while `loading`. */
  loading: string;
}

export const DEFAULT_COMBOBOX_LABELS: ComboboxLabels = {
  empty: 'No matches',
  loading: 'Loading options',
};

export interface ComboboxProps<V extends string = string> {
  options: readonly ComboboxOption<V>[];
  /** Selected value (controlled); `null` for none. */
  value?: V | null;
  defaultValue?: V | null;
  onValueChange?: (value: V | null) => void;
  /** Called with the typed text, e.g. to fetch options from a server. */
  onInputValueChange?: (text: string) => void;
  /** Decide whether an option matches the typed text. Default: case-insensitive substring. */
  filter?: (option: ComboboxOption<V>, query: string) => boolean;
  placeholder?: string;
  /** Decorative icon at the start of the input. */
  icon?: ReactNode | undefined;
  /** Options are loading: shows a spinner and the loading text, marks `aria-busy`. */
  loading?: boolean | undefined;
  disabled?: boolean;
  readOnly?: boolean | undefined;
  required?: boolean;
  /** Form field name: a hidden input carries the selected value. */
  name?: string;
  id?: string;
  className?: string;
  onBlur?: () => void;
  labels?: Partial<ComboboxLabels> | undefined;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
}

const defaultFilter = (option: ComboboxOption, query: string): boolean =>
  option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

/**
 * Editable combobox (WAI-ARIA 1.2 list autocomplete): type to filter, ArrowDown/ArrowUp to move,
 * Home/End, Enter to pick, Escape to close (again to clear), Tab to leave.
 */
export function Combobox<V extends string = string>({
  options,
  value: valueProp,
  defaultValue = null,
  onValueChange,
  onInputValueChange,
  filter = defaultFilter,
  placeholder,
  icon,
  loading = false,
  name,
  className,
  onBlur,
  labels,
  ...props
}: ComboboxProps<V>) {
  const control = useFieldControl(props);
  const text = { ...DEFAULT_COMBOBOX_LABELS, ...labels };
  const listboxId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);

  const [innerValue, setInnerValue] = useState<V | null>(defaultValue);
  const value = valueProp === undefined ? innerValue : valueProp;
  const selected = options.find((option) => option.value === value) ?? null;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputText = query ?? selected?.label ?? '';
  const visible = query === null ? options : options.filter((option) => filter(option, query));
  const enabledIndexes = visible.flatMap((option, index) => (option.disabled ? [] : [index]));
  const message = loading ? text.loading : visible.length === 0 ? text.empty : null;
  // Options are only in the DOM when there is no loading or empty message.
  const active = message ? undefined : visible[activeIndex];
  const optionId = (index: number) => `${listboxId}-option-${String(index)}`;
  const interactive = !control.disabled && !control.readOnly;

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    // jsdom has no scrollIntoView.
    const option = document.getElementById(`${listboxId}-option-${String(activeIndex)}`);
    if (option && 'scrollIntoView' in option) option.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listboxId]);

  const commit = (next: V | null) => {
    if (valueProp === undefined) setInnerValue(next);
    if (next !== value) onValueChange?.(next);
  };

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActiveIndex(-1);
  };

  const select = (index: number) => {
    const option = visible[index];
    if (!option || option.disabled) return;
    commit(option.value);
    close();
  };

  const openAt = (edge: 'first' | 'last' | 'selected') => {
    setOpen(true);
    const selectedIndex = visible.findIndex((option) => option.value === value);
    if (edge === 'selected' && selectedIndex >= 0 && !visible[selectedIndex]?.disabled) {
      setActiveIndex(selectedIndex);
    } else {
      setActiveIndex((edge === 'last' ? enabledIndexes.at(-1) : enabledIndexes[0]) ?? -1);
    }
  };

  const move = (step: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(activeIndex);
    const next =
      position === -1
        ? step === 1
          ? 0
          : enabledIndexes.length - 1
        : (position + step + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[next] ?? -1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!interactive) return;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        if (!open) openAt('selected');
        else move(1);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) openAt(value === null ? 'last' : 'selected');
        else move(-1);
        break;
      }
      case 'Home':
      case 'End': {
        if (!open) return;
        event.preventDefault();
        setActiveIndex((event.key === 'Home' ? enabledIndexes[0] : enabledIndexes.at(-1)) ?? -1);
        break;
      }
      case 'Enter': {
        if (!open || activeIndex < 0) return;
        event.preventDefault();
        select(activeIndex);
        break;
      }
      case 'Escape': {
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (value !== null || query) {
          event.preventDefault();
          event.stopPropagation();
          setQuery(null);
          commit(null);
        }
        break;
      }
      case 'Tab': {
        if (open) close();
        break;
      }
      default:
        break;
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setQuery(next);
    onInputValueChange?.(next);
    setOpen(true);
    const firstMatch = options
      .filter((option) => filter(option, next))
      .findIndex((option) => !option.disabled);
    setActiveIndex(firstMatch);
    if (next === '' && value !== null) commit(null);
  };

  const end = loading ? (
    <Spinner size="md" decorative />
  ) : control.invalid ? (
    <CircleAlert aria-hidden="true" className="text-danger" />
  ) : null;

  return (
    <PopoverPrimitive.Root
      open={open && interactive}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={anchorRef}
          data-slot="combobox"
          className={cn('relative flex w-full min-w-0 items-center', className)}
        >
          {icon ? (
            <span
              aria-hidden="true"
              className="text-ink-muted pointer-events-none absolute start-3 inline-flex [&_svg]:size-4"
            >
              {icon}
            </span>
          ) : null}
          <input
            data-slot="combobox-input"
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={open && interactive}
            aria-controls={listboxId}
            aria-activedescendant={open && active ? optionId(activeIndex) : undefined}
            aria-label={props['aria-label']}
            aria-labelledby={props['aria-labelledby']}
            {...control.ariaProps}
            aria-busy={loading || undefined}
            id={control.id}
            disabled={control.disabled}
            readOnly={control.readOnly}
            required={control.required}
            data-readonly={control.readOnly ? '' : undefined}
            placeholder={placeholder}
            value={inputText}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onClick={() => {
              if (interactive && !open) openAt('selected');
            }}
            onBlur={() => {
              close();
              onBlur?.();
            }}
            className={cn(
              controlClasses,
              controlHeight,
              'py-1 pe-9',
              icon ? 'ps-9' : null,
              end ? 'pe-15' : null,
            )}
          />
          <span
            aria-hidden="true"
            className="text-ink-muted pointer-events-none absolute end-3 inline-flex items-center gap-1.5 [&_svg]:size-4"
          >
            {end}
            <ChevronDown />
          </span>
          {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={listboxId}
          // The content is the listbox itself (or a status line while loading or empty).
          role={message ? 'status' : 'listbox'}
          aria-labelledby={message ? undefined : (control.labelId ?? props['aria-labelledby'])}
          aria-label={message || control.labelId ? undefined : props['aria-label']}
          data-slot="combobox-content"
          align="start"
          sideOffset={4}
          // Focus stays in the input: the list is driven by aria-activedescendant.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className={cn(
            'z-dropdown max-h-72 w-(--radix-popover-trigger-width) min-w-48 overflow-y-auto',
            'border-line bg-surface-overlay text-ink shadow-3 rounded-md border p-1 font-sans text-sm',
            'motion-safe:data-[state=open]:animate-fade-in',
          )}
        >
          {message ? (
            <div
              data-slot="combobox-message"
              className="text-ink-muted flex items-center gap-2 px-2 py-1.5"
            >
              {loading ? <Spinner size="md" decorative /> : null}
              {message}
            </div>
          ) : (
            visible.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-active={index === activeIndex ? '' : undefined}
                  data-slot="combobox-option"
                  // Keep focus in the input when clicking an option.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    select(index);
                  }}
                  onMouseMove={() => {
                    if (!option.disabled && activeIndex !== index) setActiveIndex(index);
                  }}
                  className={cn(
                    'relative flex cursor-default items-center rounded-sm py-1.5 ps-8 pe-2 select-none',
                    'pointer-coarse:min-h-11',
                    'data-active:bg-accent-soft',
                    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
                  )}
                >
                  {isSelected ? (
                    <Check
                      aria-hidden="true"
                      className="text-accent absolute start-2 size-4 shrink-0"
                    />
                  ) : null}
                  <span className="truncate">{option.label}</span>
                </div>
              );
            })
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
