'use client';

// The institution portfolio screens (#666, part 6 of #498): summary cards, a filter bar, the case
// table (next date, stage, last adverse order), the CSV import form (owners), the CSV export button
// and the exception-alert settings (the member's own channel switches for the two portfolio alert
// categories, through the notification preference action). The actions are props so the page binds
// the server actions and tests pass fakes. Status fields are what the poll last stored; a case
// that was never polled shows a dash, not a guess.
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Switch } from '@causedeck/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@causedeck/ui/table';
import { toast } from '@causedeck/ui/sonner';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type ChangeEvent, type FormEvent } from 'react';

import type {
  CreatedPortfolio,
  PortfolioExportResult,
  PortfolioImportResult,
} from '../../app/(app)/w/[slug]/portfolio/actions.ts';
import type { Result } from '../../lib/safe-action.ts';

export type { PortfolioImportResult };

export interface PortfolioCaseView {
  id: string;
  cnr: string | null;
  caseNumber: string | null;
  stage: string | null;
  nextDate: string | null;
  lastAdverseOrderAt: string | null;
  lastAdverseOrderRef: string | null;
}

export interface PortfolioSummaryView {
  total: number;
  byStage: { stage: string | null; count: number }[];
  withAdverseOrder: number;
  upcoming: number;
  overdue: number;
}

export interface PortfolioFilterValues {
  stage?: string | undefined;
  nextFrom?: string | undefined;
  nextTo?: string | undefined;
  adverseOnly?: boolean | undefined;
}

const DASH = '-';

export function PortfolioSummaryCards({ summary }: { summary: PortfolioSummaryView }) {
  const t = useTranslations('portfolio');
  const cards = [
    ['total', summary.total],
    ['upcoming', summary.upcoming],
    ['overdue', summary.overdue],
    ['adverse', summary.withAdverseOrder],
  ] as const;
  return (
    <section
      aria-label={t('summary.label')}
      data-portfolio-summary=""
      className="flex flex-col gap-3"
    >
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([key, value]) => (
          <div key={key} data-summary={key} className="border-line rounded-md border p-3">
            <dt className="text-ink-muted text-xs">{t(`summary.${key}`)}</dt>
            <dd className="font-serif text-2xl font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.byStage.length > 0 ? (
        <ul aria-label={t('summary.stages')} className="flex flex-wrap gap-2">
          {summary.byStage.map((row) => (
            <li key={row.stage ?? ''}>
              <Badge>
                {row.stage ?? t('summary.noStage')}: {row.count}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A plain GET form: the filters live in the URL so the page stays a server component. */
export function PortfolioFilters({
  portfolioId,
  values,
  stages,
  resetHref,
}: {
  portfolioId: string;
  values: PortfolioFilterValues;
  stages: readonly string[];
  resetHref: string;
}) {
  const t = useTranslations('portfolio');
  return (
    <form method="get" data-portfolio-filters="" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="portfolio" value={portfolioId} />
      <label className="flex flex-col gap-1 text-sm">
        {t('filters.stage')}
        <select
          name="stage"
          defaultValue={values.stage ?? ''}
          className="border-line bg-surface h-9 rounded-md border px-2"
        >
          <option value="">{t('filters.anyStage')}</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('filters.from')}
        <Input type="date" name="from" defaultValue={values.nextFrom ?? ''} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('filters.to')}
        <Input type="date" name="to" defaultValue={values.nextTo ?? ''} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="adverse"
          value="1"
          defaultChecked={values.adverseOnly === true}
        />
        {t('filters.adverseOnly')}
      </label>
      <Button type="submit">{t('filters.apply')}</Button>
      <a href={resetHref} className="text-accent text-sm underline-offset-2 hover:underline">
        {t('filters.reset')}
      </a>
    </form>
  );
}

export function PortfolioCaseTable({ cases }: { cases: readonly PortfolioCaseView[] }) {
  const t = useTranslations('portfolio');
  if (cases.length === 0) {
    return (
      <p data-portfolio-cases-empty="" className="text-ink-muted text-sm">
        {t('table.empty')}
      </p>
    );
  }
  return (
    <Table data-portfolio-cases="" aria-label={t('table.label')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('table.reference')}</TableHead>
          <TableHead>{t('table.stage')}</TableHead>
          <TableHead>{t('table.nextDate')}</TableHead>
          <TableHead>{t('table.adverse')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cases.map((row) => (
          <TableRow key={row.id} data-case-id={row.id}>
            <TableCell>{row.cnr ?? row.caseNumber ?? DASH}</TableCell>
            <TableCell>{row.stage ?? DASH}</TableCell>
            <TableCell>{row.nextDate ?? DASH}</TableCell>
            <TableCell>
              {row.lastAdverseOrderAt === null ? (
                DASH
              ) : (
                <Badge tone="danger" data-adverse="">
                  {t('table.adverseOrder', {
                    date: row.lastAdverseOrderAt.slice(0, 10),
                  })}
                  {row.lastAdverseOrderRef === null ? '' : ` (${row.lastAdverseOrderRef})`}
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PortfolioCreateForm({
  workspaceId,
  createAction,
}: {
  workspaceId: string;
  createAction: (input: { workspaceId: string; name: string }) => Promise<Result<CreatedPortfolio>>;
}) {
  const t = useTranslations('portfolio');
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(null);
    const result = await createAction({ workspaceId, name });
    setBusy(false);
    if (!result.ok) {
      setFailed(result.error.message);
      return;
    }
    toast.success(t('create.created'));
    router.push(`?portfolio=${result.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-portfolio-create="" className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        {t('create.label')}
        <Input
          value={name}
          maxLength={200}
          required
          placeholder={t('create.placeholder')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setName(e.target.value);
          }}
        />
      </label>
      {failed === null ? null : <Alert tone="danger">{failed}</Alert>}
      <div>
        <Button type="submit" disabled={busy || name.trim() === ''}>
          {t('create.submit')}
        </Button>
      </div>
    </form>
  );
}

export function PortfolioImportForm({
  workspaceId,
  portfolioId,
  importAction,
}: {
  workspaceId: string;
  portfolioId: string;
  importAction: (input: {
    workspaceId: string;
    portfolioId: string;
    csv: string;
  }) => Promise<Result<PortfolioImportResult>>;
}) {
  const t = useTranslations('portfolio');
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PortfolioImportResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setReport(null);
    setFailed(null);
    if (file === undefined) {
      setCsv(null);
      setFileName('');
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (csv === null) return;
    setBusy(true);
    setFailed(null);
    const result = await importAction({ workspaceId, portfolioId, csv });
    setBusy(false);
    if (!result.ok) {
      setFailed(result.error.message);
      return;
    }
    setReport(result.data);
    toast.success(t('import.done', { created: result.data.created }));
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-portfolio-import="" className="flex flex-col gap-3">
      <p className="text-ink-muted max-w-prose text-sm">{t('import.hint')}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t('import.file')}
        <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e)} />
      </label>
      {fileName === '' ? null : <p className="text-ink-muted text-xs">{fileName}</p>}
      {failed === null ? null : (
        <Alert tone="danger" data-import-failed="">
          {failed}
        </Alert>
      )}
      {report === null ? null : (
        <div data-import-report="" role="status" className="flex flex-col gap-1 text-sm">
          <p>
            {t('import.report', {
              created: report.created,
              duplicates: report.duplicates,
              invalid: report.invalid,
              watched: report.watched,
              unwatched: report.unwatched,
            })}
          </p>
          {report.errors.length > 0 ? (
            <ul className="text-ink-muted list-disc pl-5 text-xs">
              {report.errors.slice(0, 20).map((e) => (
                <li key={`${String(e.line)}-${e.message}`}>
                  {t('import.errorLine', { line: e.line, message: e.message })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div>
        <Button type="submit" disabled={busy || csv === null}>
          {t('import.submit')}
        </Button>
      </div>
    </form>
  );
}

export function PortfolioExportButton({
  workspaceId,
  portfolioId,
  exportAction,
}: {
  workspaceId: string;
  portfolioId: string;
  exportAction: (input: {
    workspaceId: string;
    portfolioId: string;
  }) => Promise<Result<PortfolioExportResult>>;
}) {
  const t = useTranslations('portfolio');
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    const result = await exportAction({ workspaceId, portfolioId });
    setBusy(false);
    if (!result.ok) {
      toast.error(t('export.failed'));
      return;
    }
    const url = URL.createObjectURL(
      new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = result.data.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      data-portfolio-export=""
      onClick={() => void download()}
    >
      {t('export.button')}
    </Button>
  );
}

export const PORTFOLIO_ALERT_CATEGORIES = [
  'portfolio.adverse_order',
  'portfolio.missed_date',
] as const;
export type PortfolioAlertCategory = (typeof PORTFOLIO_ALERT_CATEGORIES)[number];
const CATEGORY_MESSAGE = {
  'portfolio.adverse_order': 'adverseOrder',
  'portfolio.missed_date': 'missedDate',
} as const;
const CHANNEL_MESSAGE = { in_app: 'inApp', email: 'email', push: 'push' } as const;

export interface PortfolioAlertCell {
  category: PortfolioAlertCategory;
  channel: keyof typeof CHANNEL_MESSAGE;
  enabled: boolean;
  locked: boolean;
}

export function PortfolioAlertSettings({
  workspaceId,
  cells,
  setPreference,
}: {
  workspaceId: string;
  cells: readonly PortfolioAlertCell[];
  setPreference: (input: {
    workspaceId: string;
    category: PortfolioAlertCategory;
    channel: PortfolioAlertCell['channel'];
    enabled: boolean;
  }) => Promise<Result<unknown>>;
}) {
  const t = useTranslations('portfolio');
  const [state, setState] = useState(
    () => new Map(cells.map((c) => [`${c.category}|${c.channel}`, c.enabled])),
  );

  async function toggle(cell: PortfolioAlertCell, enabled: boolean) {
    const key = `${cell.category}|${cell.channel}`;
    setState((prev) => new Map(prev).set(key, enabled));
    const result = await setPreference({
      workspaceId,
      category: cell.category,
      channel: cell.channel,
      enabled,
    });
    if (!result.ok) {
      setState((prev) => new Map(prev).set(key, !enabled));
      toast.error(t('alerts.failed'));
    }
  }

  return (
    <section
      aria-label={t('alerts.title')}
      data-portfolio-alerts=""
      className="flex flex-col gap-3"
    >
      <p className="text-ink-muted max-w-prose text-sm">{t('alerts.hint')}</p>
      {PORTFOLIO_ALERT_CATEGORIES.map((category) => (
        <div key={category} data-alert-category={category} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t(`alerts.${CATEGORY_MESSAGE[category]}`)}</h3>
          <div className="flex flex-wrap gap-4">
            {cells
              .filter((cell) => cell.category === category)
              .map((cell) => (
                <label key={cell.channel} className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={state.get(`${cell.category}|${cell.channel}`) ?? cell.enabled}
                    disabled={cell.locked}
                    data-channel={cell.channel}
                    aria-label={t('alerts.switchLabel', {
                      category: t(`alerts.${CATEGORY_MESSAGE[category]}`),
                      channel: t(`alerts.channels.${CHANNEL_MESSAGE[cell.channel]}`),
                    })}
                    onCheckedChange={(value) => void toggle(cell, value)}
                  />
                  {t(`alerts.channels.${CHANNEL_MESSAGE[cell.channel]}`)}
                </label>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
