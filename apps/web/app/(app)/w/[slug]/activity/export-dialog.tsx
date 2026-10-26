'use client';
// Export confirmation (#232), loaded on demand by `export-button.tsx`. Format (CSV or JSON Lines),
// the range (IST days, `to` inclusive; defaults to the feed's filter, else the last 30 days) and an
// optional byte order mark for Excel. Confirming asks `POST /api/audit/export` for a short-lived
// signed link (it re-checks `audit.read`) and follows it; the route streams the file as an
// attachment and records `audit.exported`.
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { toast } from '@causedeck/ui/sonner';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { istDay, istDayAfter, istDayStart, type AuditFilterValues } from './filter-params.ts';

type Format = 'csv' | 'jsonl';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExportDialogProps {
  workspaceId: string;
  filters: AuditFilterValues;
  onOpenChange: (open: boolean) => void;
  /** Today, for the default range. Fixed in tests. */
  now?: Date | undefined;
}

export function ExportDialog({ workspaceId, filters, onOpenChange, now }: ExportDialogProps) {
  const t = useTranslations('audit.export');
  const id = useId();
  const today = now ?? new Date();
  const [format, setFormat] = useState<Format>('csv');
  const [bom, setBom] = useState(false);
  const [from, setFrom] = useState(filters.from ?? istDay(new Date(today.getTime() - 30 * DAY_MS)));
  const [to, setTo] = useState(filters.to ?? istDay(today));
  const [busy, setBusy] = useState(false);
  const invalid = !from || !to || from > to;

  const submit = async () => {
    if (invalid) return;
    if (!navigator.onLine) {
      toast(t('offline'));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/audit/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          from: istDayStart(from),
          to: istDayAfter(to),
          format,
          bom,
        }),
      });
      if (response.status === 403) {
        toast(t('denied'));
        return;
      }
      if (!response.ok) {
        toast(t('failed'));
        return;
      }
      const { url } = (await response.json()) as { url: string };
      window.location.assign(url);
      toast(t('started'));
      onOpenChange(false);
    } catch {
      toast(t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="audit-export-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-format`}>{t('format')}</Label>
            <Select
              value={format}
              onValueChange={(value) => {
                setFormat(value as Format);
              }}
            >
              <SelectTrigger id={`${id}-format`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">{t('csv')}</SelectItem>
                <SelectItem value="jsonl">{t('jsonl')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-from`}>{t('from')}</Label>
              <Input
                id={`${id}-from`}
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => {
                  setFrom(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-to`}>{t('to')}</Label>
              <Input
                id={`${id}-to`}
                type="date"
                value={to}
                min={from || undefined}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${id}-range` : undefined}
                onChange={(event) => {
                  setTo(event.target.value);
                }}
              />
            </div>
          </div>
          {invalid ? (
            <p id={`${id}-range`} role="alert" className="text-danger text-sm">
              {t('rangeInvalid')}
            </p>
          ) : null}
          {format === 'csv' ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-bom`}
                checked={bom}
                onCheckedChange={(checked) => {
                  setBom(checked === true);
                }}
              />
              <Label htmlFor={`${id}-bom`}>{t('bom')}</Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={invalid}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
