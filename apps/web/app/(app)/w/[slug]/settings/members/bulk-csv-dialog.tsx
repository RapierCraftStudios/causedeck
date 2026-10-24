'use client';
// `Import CSV` (#684, part of #508): paste or upload a CSV, `Check (dry run)` to see what each row
// would do, then `Provision members` to run it. The report lists every row with its outcome and the
// reason a row was skipped or failed; the dry run changes nothing but its own run record.
import type { ProvisioningReport } from '@causedeck/core/provisioning';
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { toast } from '@causedeck/ui/sonner';
import { Textarea } from '@causedeck/ui/textarea';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ChangeEvent } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';

import { useOnline } from './role-select.tsx';

export type ProvisionCsv = (input: {
  workspaceId: string;
  csv: string;
  dryRun: boolean;
}) => Promise<Result<ProvisioningReport>>;

export interface BulkCsvDialogProps {
  workspaceId: string;
  provision: ProvisionCsv;
}

export function BulkCsvDialog({ workspaceId, provision }: BulkCsvDialogProps) {
  const t = useTranslations('provisioning');
  const online = useOnline();
  const csvId = useId();
  const fileId = useId();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ProvisioningReport | null>(null);

  function change(text: string) {
    setCsv(text);
    setReport(null);
    setError(null);
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then(change);
  }

  async function run(dryRun: boolean) {
    if (csv.trim() === '') {
      setError(t('empty'));
      return;
    }
    setPending(true);
    setError(null);
    const result = await provision({ workspaceId, csv, dryRun });
    setPending(false);
    if (!result.ok) {
      const { code } = result.error;
      setError(code === 'FORBIDDEN' ? t('forbidden') : code === 'VALIDATION' ? t('tooLarge') : t('failed'));
      return;
    }
    setReport(result.data);
    if (!dryRun) toast(t('toast.done', { created: result.data.created }));
  }

  const summaryKey = report?.dryRun === false ? 'report.summaryDone' : 'report.summary';
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
        disabled={!online}
        data-slot="bulk-csv-trigger"
      >
        <Upload aria-hidden="true" />
        {t('trigger')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={fileId} className="text-sm font-medium">
                {t('fileLabel')}
              </label>
              <input
                id={fileId}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="text-sm"
              />
            </div>
            <Field label={t('csvLabel')} controlId={csvId}>
              <Textarea
                id={csvId}
                value={csv}
                rows={6}
                placeholder={t('csvPlaceholder')}
                onChange={(event) => {
                  change(event.target.value);
                }}
                className="font-mono text-xs"
              />
            </Field>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {report ? (
              <section aria-live="polite" className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">
                  {report.dryRun ? t('report.dryRunTitle') : t('report.doneTitle')}
                </h3>
                <p className="text-ink-muted text-sm">
                  {t(summaryKey, {
                    created: report.created,
                    skipped: report.skipped,
                    errors: report.errors,
                    total: report.totalRows,
                  })}
                </p>
                <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm">
                  {report.rows.map((row) => (
                    <li key={row.line} data-outcome={row.outcome} className="flex flex-wrap gap-x-2">
                      <span className="text-ink-muted">{t('report.line', { line: row.line })}</span>
                      <span>{row.email ?? t('report.noEmail')}</span>
                      <span className="font-medium">{t(`report.outcome.${row.outcome}`)}</span>
                      {row.reason ? (
                        <span className="text-ink-muted">{t(`report.reason.${row.reason}`)}</span>
                      ) : null}
                      {row.message ? <span className="text-ink-muted">{row.message}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('close')}
            </Button>
            <Button
              variant="secondary"
              disabled={pending || !online}
              onClick={() => {
                void run(true);
              }}
            >
              {pending ? t('working') : t('dryRun')}
            </Button>
            <Button
              disabled={pending || !online || report?.dryRun !== true || report.created === 0}
              onClick={() => {
                void run(false);
              }}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
