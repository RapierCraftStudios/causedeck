'use client';
// Propose a limitation date (#941, #84): the matter, a reviewed rule, the start date and any
// excluded days. Only reviewed rules are offered; the server checks everything again. `Esc` closes
// the dialog and focus returns to the invoker; offline, computing is off.
import type { RuleView } from '@causedeck/core/limitation';
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { limitationErrorKey, type LimitationActions } from './limitation-actions.ts';

export interface ProposeFormProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: readonly RuleView[];
  offline?: boolean;
  compute: LimitationActions['compute'];
}

export function ProposeForm({
  workspaceId,
  open,
  onOpenChange,
  rules,
  offline = false,
  compute,
}: ProposeFormProps) {
  const t = useTranslations('limitation');
  const router = useRouter();
  const ruleId = useId();
  const codes = [...new Set(rules.map((r) => r.code))];
  const [matterId, setMatterId] = useState('');
  const [ruleCode, setRuleCode] = useState(codes[0] ?? '');
  const [startDate, setStartDate] = useState('');
  const [excluded, setExcluded] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await compute({
      workspaceId,
      matterId: matterId.trim(),
      ruleCode,
      startDate,
      excludedDays: Number(excluded) || 0,
    });
    setSaving(false);
    if (!result.ok) {
      setError(t(`form.error.${limitationErrorKey(result.error.code)}`));
      return;
    }
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('form.title')}</DialogTitle>
        </DialogHeader>
        {error === null ? null : (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <form
          noValidate
          id="limitation-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t('form.matter')} required>
            <Input
              autoComplete="off"
              data-limitation-field="matter"
              value={matterId}
              onChange={(event) => {
                setMatterId(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.rule')} controlId={ruleId}>
            <select
              id={ruleId}
              data-limitation-field="rule"
              className="border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm"
              value={ruleCode}
              onChange={(event) => {
                setRuleCode(event.target.value);
              }}
            >
              {codes.map((code) => (
                <option key={code} value={code}>
                  {rules.find((r) => r.code === code)?.title ?? code}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('form.start')} required>
            <Input
              type="date"
              data-limitation-field="start"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
              }}
            />
          </Field>
          <Field label={t('form.excluded')}>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              data-limitation-field="excluded"
              value={excluded}
              onChange={(event) => {
                setExcluded(event.target.value);
              }}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('form.cancel')}
          </Button>
          <Button type="submit" form="limitation-form" disabled={saving || offline}>
            {t('form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
