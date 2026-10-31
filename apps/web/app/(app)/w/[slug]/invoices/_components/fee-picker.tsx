'use client';
// A matter or client picker (#963): a labelled select over the matters or clients the actor may see,
// replacing the plain id inputs. From twelve options a filter narrows the list. The chosen id is
// always an option, even when the list failed to load or the filter hides it, so an opened draft
// keeps its matter and client. With nothing to choose from, a hint says why. The server checks
// every id again; this is a convenience, not a gate.
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { PickerOption } from '../../../../../../lib/fees/fees-deps.ts';

export interface FeePickerProps {
  label: string;
  /** `data-fees-field` of the select, for tests. */
  field: string;
  options: readonly PickerOption[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  /** Offers an empty choice with this label (an optional matter). */
  noneLabel?: string;
  disabled?: boolean;
}

const SELECT_CLASS = 'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm';
const FILTER_FROM = 12;

export function FeePicker({
  label,
  field,
  options,
  value,
  onChange,
  required = false,
  noneLabel,
  disabled = false,
}: FeePickerProps) {
  const t = useTranslations('fees');
  const selectId = useId();
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = options.filter(
    (option) => option.id === value || needle === '' || option.label.toLowerCase().includes(needle),
  );
  const known = options.some((option) => option.id === value);
  const extra = value !== '' && !known ? [{ id: value, label: value }] : [];
  return (
    <div className="flex flex-col gap-2" data-slot="fee-picker">
      {options.length >= FILTER_FROM ? (
        <Field label={t('picker.filter', { label })}>
          <Input
            type="search"
            autoComplete="off"
            data-fees-field={`${field}-filter`}
            value={filter}
            disabled={disabled}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
        </Field>
      ) : null}
      <Field label={label} controlId={selectId} required={required}>
        <select
          id={selectId}
          data-fees-field={field}
          className={SELECT_CLASS}
          value={value}
          disabled={disabled}
          required={required}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{noneLabel ?? t('picker.choose')}</option>
          {[...extra, ...shown].map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      {options.length === 0 ? (
        <p className="text-ink-muted text-xs" data-slot="fee-picker-empty">
          {t('picker.none')}
        </p>
      ) : null}
    </div>
  );
}
