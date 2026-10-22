'use client';
// Add or edit a proceeding (#392, #40 part 4), react-hook-form + zod. Fields: the forum (from the
// courts catalogue), the case type (a combobox over the forum's adapter nomenclature that matches
// in any punctuation, `W.P.`, `wp` or `W P` for `WP`, and keeps free text the list does not have),
// number and year, SR/FR/diary/filing/CNR, the parent it is filed in (when adding; core has no
// re-parent) and connected / appeal-from / lower-court links to the matter's other proceedings.
// When the identity is complete (case type, number and year, or a CNR) leaving the field asks
// `findDuplicateProceedingsAction`: a match shows "Looks like WP 12345/2026 which is already here.
// Merge?" with `Open it` (a proceeding of this matter: nothing is created) or `Merge` (another
// matter: the merge dialog opens with it). Saving calls the create or update action, then links;
// `Esc` closes and focus returns to the button that opened the form.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Combobox, type ComboboxOption } from '@causedeck/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Form, FormField, useZodForm } from '@causedeck/ui/form';
import { controlClasses, controlHeight, Input } from '@causedeck/ui/input';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { z } from 'zod';

import { compactCaseTypeCode } from '../../lib/matters/case-type-code.ts';
import type { CaseTypeOption } from '../../lib/matters/case-types.ts';
import type { ForumOption, ProceedingRowView } from '../../lib/matters/proceedings-view.ts';
import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';

export interface DuplicateHit {
  id: string;
  matterId: string;
  sameMatter: boolean;
  caseType: string;
  number: string | null;
  year: number | null;
  cnr: string | null;
}

type Nullable<T> = { [K in keyof T]: T[K] | null };

interface Identifiers {
  number: string;
  year: number;
  cnr: string;
  srNo: string;
  frNo: string;
  diaryNo: string;
  filingNo: string;
}

export type CreateProceedingInput = {
  workspaceId: string;
  matterId: string;
  forumId: string;
  caseType: string;
  parentProceedingId?: string;
} & Partial<Identifiers>;
export type UpdateProceedingInput = {
  workspaceId: string;
  proceedingId: string;
  caseType?: string;
} & Partial<Nullable<Identifiers>>;

export interface ProceedingFormActions {
  create: (input: CreateProceedingInput) => Promise<Result<{ id: string }>>;
  update: (input: UpdateProceedingInput) => Promise<Result<{ id: string }>>;
  link: (input: {
    workspaceId: string;
    fromProceedingId: string;
    toProceedingId: string;
    kind: 'connected' | 'appeal_from' | 'lower_court';
  }) => Promise<Result<unknown>>;
  findDuplicates: (input: {
    workspaceId: string;
    matterId: string;
    identity: { caseType?: string; number?: string; year?: number; cnr?: string };
    excludeProceedingId?: string;
  }) => Promise<Result<DuplicateHit[]>>;
}

export interface ProceedingFormProps {
  workspaceId: string;
  matterId: string;
  forums: readonly ForumOption[];
  /** Every proceeding of the matter, for the parent and link pickers. */
  rows: readonly Pick<ProceedingRowView, 'id' | 'label'>[];
  /** Edit this row; omitted to add a proceeding. */
  editing?: ProceedingRowView | undefined;
  actions: ProceedingFormActions;
  offline?: boolean;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  /** `Open it`: a duplicate in this matter. */
  onOpenExisting?: (proceedingId: string) => void;
  /** `Merge`: a duplicate in another matter. */
  onMergeMatter?: (matterId: string) => void;
}

const FIELDS = ['number', 'year', 'srNo', 'frNo', 'diaryNo', 'filingNo', 'cnr'] as const;
type IdentifierField = (typeof FIELDS)[number];
const LINKS = [
  ['connected', 'connected'],
  ['appealFrom', 'appeal_from'],
  ['lowerCourt', 'lower_court'],
] as const;

export interface ProceedingDraft {
  forumId: string;
  caseType: string;
  number: string;
  year: string;
  srNo: string;
  frNo: string;
  diaryNo: string;
  filingNo: string;
  cnr: string;
  parentId: string;
  connected: string;
  appealFrom: string;
  lowerCourt: string;
}

const CNR = /^[A-Za-z0-9]{16}$/;

/** A year as typed: blank, two digits, or 1800..2200. */
export function parseYear(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d{2}$|^\d{4}$/.test(trimmed)) return 'invalid';
  const year = Number(trimmed);
  return year <= 99 || (year >= 1800 && year <= 2200) ? year : 'invalid';
}

export function proceedingSchema(messages: {
  required: string;
  invalidYear: string;
  invalidCnr: string;
}) {
  const field = z.string();
  return z
    .object({
      forumId: field,
      caseType: field,
      number: field,
      year: field,
      srNo: field,
      frNo: field,
      diaryNo: field,
      filingNo: field,
      cnr: field,
      parentId: field,
      connected: field,
      appealFrom: field,
      lowerCourt: field,
    })
    .superRefine((value, ctx) => {
      if (value.forumId === '') {
        ctx.addIssue({ code: 'custom', path: ['forumId'], message: messages.required });
      }
      if (value.caseType.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['caseType'], message: messages.required });
      }
      if (parseYear(value.year) === 'invalid') {
        ctx.addIssue({ code: 'custom', path: ['year'], message: messages.invalidYear });
      }
      if (value.cnr.trim() !== '' && !CNR.test(value.cnr.trim())) {
        ctx.addIssue({ code: 'custom', path: ['cnr'], message: messages.invalidCnr });
      }
    });
}

/** Whether `option` matches the typed text in any punctuation (`W.P.`, `wp`, `W P`). */
export function caseTypeMatches(option: CaseTypeOption, query: string): boolean {
  const q = compactCaseTypeCode(query);
  if (q === '') return true;
  return [option.label, option.code, ...option.aliases].some((spelling) =>
    compactCaseTypeCode(spelling).includes(q),
  );
}

/** The combobox options: the forum's case types, plus the typed text when the list lacks it. */
export function caseTypeComboOptions(
  caseTypes: readonly CaseTypeOption[],
  typed: string,
): ComboboxOption[] {
  const options = caseTypes.map((type) => ({ value: type.label, label: type.label }));
  const code = compactCaseTypeCode(typed);
  if (code !== '' && !caseTypes.some((type) => compactCaseTypeCode(type.label) === code)) {
    options.unshift({ value: typed, label: typed });
  }
  return options;
}

function draftOf(row: ProceedingRowView | undefined): ProceedingDraft {
  return {
    forumId: row?.forumId ?? '',
    caseType: row?.caseType ?? '',
    number: row?.caseNumber?.number ?? '',
    year: row?.caseNumber === null || row === undefined ? '' : String(row.caseNumber.year),
    srNo: row?.srNo ?? '',
    frNo: row?.frNo ?? '',
    diaryNo: row?.diaryNo ?? '',
    filingNo: row?.filingNo ?? '',
    cnr: row?.cnr ?? '',
    parentId: '',
    connected: '',
    appealFrom: '',
    lowerCourt: '',
  };
}

function identifierValue(draft: ProceedingDraft, key: IdentifierField): string | number | null {
  if (key === 'year') {
    const year = parseYear(draft.year);
    return year === 'invalid' ? null : year;
  }
  const value = draft[key].trim();
  return value === '' ? null : key === 'cnr' ? value.toUpperCase() : value;
}

/** The create input: blank fields left out. */
export function createInput(
  base: { workspaceId: string; matterId: string },
  draft: ProceedingDraft,
): CreateProceedingInput {
  const input: CreateProceedingInput = {
    ...base,
    forumId: draft.forumId,
    caseType: draft.caseType.trim(),
  };
  for (const key of FIELDS) {
    const value = identifierValue(draft, key);
    if (value !== null) Object.assign(input, { [key]: value });
  }
  if (draft.parentId !== '') input.parentProceedingId = draft.parentId;
  return input;
}

/** The update input: only what changed (a cleared field is `null`); null when nothing did. */
export function updateInput(
  base: { workspaceId: string; proceedingId: string },
  before: ProceedingDraft,
  draft: ProceedingDraft,
): UpdateProceedingInput | null {
  const input: UpdateProceedingInput = { ...base };
  let changed = false;
  if (draft.caseType.trim() !== before.caseType.trim()) {
    input.caseType = draft.caseType.trim();
    changed = true;
  }
  for (const key of FIELDS) {
    const next = identifierValue(draft, key);
    if (next !== identifierValue(before, key)) {
      Object.assign(input, { [key]: next });
      changed = true;
    }
  }
  return changed ? input : null;
}

/** The identity the duplicate finder takes, or null while it is incomplete. */
export function identityOf(
  draft: ProceedingDraft,
): { caseType?: string; number?: string; year?: number; cnr?: string } | null {
  const cnr = draft.cnr.trim();
  if (CNR.test(cnr)) return { cnr: cnr.toUpperCase() };
  const year = parseYear(draft.year);
  const number = draft.number.trim();
  const caseType = draft.caseType.trim();
  if (caseType === '' || number === '' || year === null || year === 'invalid') return null;
  return { caseType, number, year };
}

function duplicateLabel(hit: DuplicateHit): string {
  if (hit.number !== null && hit.year !== null) {
    return `${hit.caseType} ${hit.number}/${String(hit.year)}`;
  }
  return hit.cnr ?? hit.caseType;
}

const selectClasses = `${controlClasses} ${controlHeight} w-full`;

export function ProceedingForm({
  workspaceId,
  matterId,
  forums,
  rows,
  editing,
  actions,
  offline = false,
  onClose,
  returnFocus,
  onOpenExisting,
  onMergeMatter,
}: ProceedingFormProps) {
  const t = useTranslations('matters.workspace.proceedingsTab.form');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const before = draftOf(editing);
  const form = useZodForm(
    proceedingSchema({
      required: t('required'),
      invalidYear: t('invalidYear'),
      invalidCnr: t('invalidCnr'),
    }),
    { defaultValues: before },
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const forumId = form.watch('forumId');
  const caseType = form.watch('caseType');
  const forum = forums.find((f) => f.id === forumId);
  const caseTypes = forum?.caseTypes ?? [];
  const caseTypeOptions = caseTypeComboOptions(caseTypes, caseType);
  const freeText =
    caseType.trim() !== '' &&
    caseTypes.length > 0 &&
    !caseTypes.some((type) => compactCaseTypeCode(type.label) === compactCaseTypeCode(caseType));
  const others = rows.filter((row) => row.id !== editing?.id);
  const pending = form.formState.isSubmitting;

  async function checkDuplicates() {
    const identity = identityOf(form.getValues());
    if (identity === null) {
      setDuplicate(null);
      return;
    }
    try {
      const result = await actions.findDuplicates({
        workspaceId,
        matterId,
        identity,
        ...(editing === undefined ? {} : { excludeProceedingId: editing.id }),
      });
      setDuplicate(result.ok ? (result.data[0] ?? null) : null);
    } catch {
      setDuplicate(null);
    }
  }

  async function linkAll(proceedingId: string, draft: ProceedingDraft): Promise<boolean> {
    for (const [field, kind] of LINKS) {
      const to = draft[field];
      if (to === '') continue;
      const result = await actions.link({
        workspaceId,
        fromProceedingId: proceedingId,
        toProceedingId: to,
        kind,
      });
      if (!result.ok) return false;
    }
    return true;
  }

  async function onSubmit(draft: ProceedingDraft) {
    if (offline) return;
    setFailure(null);
    try {
      let id: string;
      if (editing === undefined) {
        const result = await actions.create(createInput({ workspaceId, matterId }, draft));
        if (!result.ok) {
          setFailure(result.error.code === 'CONFLICT' ? t('conflict') : t('failed'));
          return;
        }
        id = result.data.id;
      } else {
        id = editing.id;
        const input = updateInput({ workspaceId, proceedingId: editing.id }, before, draft);
        if (input !== null) {
          const result = await actions.update(input);
          if (!result.ok) {
            setFailure(result.error.code === 'CONFLICT' ? t('conflict') : t('failed'));
            return;
          }
        }
      }
      if (!(await linkAll(id, draft))) {
        setFailure(t('failed'));
        router.refresh();
        return;
      }
    } catch {
      setFailure(t('failed'));
      return;
    }
    announce(editing === undefined ? t('announceAdded') : t('announceSaved'));
    onClose();
    router.refresh();
  }

  const title = editing === undefined ? t('addTitle') : t('editTitle', { label: editing.label });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-slot="proceeding-form"
        className="max-h-[90dvh] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          const element = returnFocus?.() ?? null;
          if (element === null) return;
          event.preventDefault();
          element.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="flex flex-col gap-4">
          <FormField
            name="forumId"
            label={t('forum')}
            required
            disabled={editing !== undefined}
            hint={forums.length === 0 ? t('noForums') : undefined}
            render={({ field }) => (
              <select
                {...field}
                data-forum-select=""
                className={selectClasses}
                disabled={editing !== undefined}
              >
                <option value="">{t('forumPlaceholder')}</option>
                {forums.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          />
          <FormField
            name="caseType"
            label={t('caseType')}
            required
            hint={freeText ? t('caseTypeFreeText') : t('caseTypeHint')}
            render={({ field }) => (
              <Combobox
                name={field.name}
                options={caseTypeOptions}
                value={caseType === '' ? null : caseType}
                onValueChange={(value) => {
                  field.onChange(value ?? '');
                }}
                onInputValueChange={(text) => {
                  field.onChange(text);
                }}
                onBlur={() => {
                  field.onBlur();
                  void checkDuplicates();
                }}
                filter={(option, query) => {
                  const known = caseTypes.find((type) => type.label === option.value);
                  return known === undefined
                    ? compactCaseTypeCode(option.label).includes(compactCaseTypeCode(query))
                    : caseTypeMatches(known, query);
                }}
              />
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            {(['number', 'year'] as const).map((name) => (
              <FormField
                key={name}
                name={name}
                label={t(name)}
                render={({ field }) => (
                  <Input
                    {...field}
                    autoComplete="off"
                    inputMode={name === 'year' ? 'numeric' : undefined}
                    onBlur={() => {
                      field.onBlur();
                      void checkDuplicates();
                    }}
                  />
                )}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['srNo', 'frNo', 'diaryNo', 'filingNo'] as const).map((name) => (
              <FormField
                key={name}
                name={name}
                label={t(name)}
                render={({ field }) => <Input {...field} autoComplete="off" />}
              />
            ))}
          </div>
          <FormField
            name="cnr"
            label={t('cnr')}
            render={({ field }) => (
              <Input
                {...field}
                autoComplete="off"
                className="font-mono uppercase"
                onBlur={() => {
                  field.onBlur();
                  void checkDuplicates();
                }}
              />
            )}
          />
          {duplicate === null ? null : (
            <Alert tone="warning" role="status" data-duplicate={duplicate.id}>
              <div className="flex flex-col gap-2">
                <p>{t('duplicate', { label: duplicateLabel(duplicate) })}</p>
                <div className="flex gap-2">
                  {duplicate.sameMatter ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-duplicate-open=""
                      onClick={() => {
                        onClose();
                        onOpenExisting?.(duplicate.id);
                      }}
                    >
                      {t('openIt')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-duplicate-merge=""
                      onClick={() => {
                        onClose();
                        onMergeMatter?.(duplicate.matterId);
                      }}
                    >
                      {t('merge')}
                    </Button>
                  )}
                </div>
              </div>
            </Alert>
          )}
          {others.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {editing === undefined ? (
                <FormField
                  name="parentId"
                  label={t('parent')}
                  render={({ field }) => (
                    <select {...field} data-picker="parent" className={selectClasses}>
                      <option value="">{t('noParent')}</option>
                      {others.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  )}
                />
              ) : null}
              {LINKS.map(([name]) => (
                <FormField
                  key={name}
                  name={name}
                  label={t(name)}
                  render={({ field }) => (
                    <select {...field} data-picker={name} className={selectClasses}>
                      <option value="">{t('none')}</option>
                      {others.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  )}
                />
              ))}
            </div>
          ) : null}
          {failure === null ? null : (
            <Alert tone="danger" role="alert">
              {failure}
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              data-proceeding-save=""
              loading={pending}
              disabled={pending || offline}
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
