// `/w/[slug]/portfolio` (#666, part 6 of #498, D-048 B2B): an institution's tracked cases. One read
// in this workspace's RLS scope (`inWorkspace`, `@causedeck/core/portfolio`) gives the portfolios,
// and for the selected one (`?portfolio=<id>`, else the first) the summary and the cases filtered
// by `?stage=`, `?from=`, `?to=` (next date window) and `?adverse=1`. Owners also get portfolio
// creation and the CSV import (up to 1,000 rows; creates delegated watches, never bulk captcha);
// every member gets the CSV export and their own switches for the two exception alerts (a new
// adverse order, a missed next date). Other roles read the same dashboard with a read-only note.
//
// States: loading (skeleton), error (`error.tsx`), empty (no portfolio yet) and permission-denied
// (a FORBIDDEN from core). In development, `?__state=loading|error|denied` previews them.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  PORTFOLIO_ALERT_CATEGORIES,
  PortfolioAlertSettings,
  PortfolioCaseTable,
  PortfolioCreateForm,
  PortfolioExportButton,
  PortfolioFilters,
  PortfolioImportForm,
  PortfolioSummaryCards,
  type PortfolioAlertCell,
  type PortfolioCaseView,
  type PortfolioSummaryView,
} from '../../../../../components/portfolio/portfolio-view.tsx';
import { PermissionDeniedPage } from '../../../../../components/shell/permission-denied-page.tsx';
import { isDev } from '../../../../../lib/env.ts';
import { getWorkspaceContext } from '../../../../../lib/workspace-loader.ts';
import {
  setNotificationPreferenceAction,
  type PreferenceView,
} from '../settings/notifications/actions.ts';

import {
  createPortfolioAction,
  exportPortfolioCsvAction,
  importPortfolioAction,
} from './actions.ts';
import PortfolioLoading from './loading.tsx';

type SearchParams = Record<string, string | string[] | undefined>;

interface PortfolioPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function day(value: string | string[] | undefined): string | undefined {
  const v = first(value);
  return v !== undefined && DAY.test(v) ? v : undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portfolio');
  return { title: t('metaTitle') };
}

interface Loaded {
  portfolios: { id: string; name: string }[];
  selected: { id: string; name: string } | null;
  summary: PortfolioSummaryView | null;
  cases: PortfolioCaseView[];
  alertCells: PortfolioAlertCell[];
}

export default async function PortfolioPage({ params, searchParams }: PortfolioPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // The layout already checks membership; checking again keeps the page safe on its own.
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();

  const state = isDev() ? first(query.__state) : undefined;
  if (state === 'loading') return <PortfolioLoading />;
  if (state === 'error') throw new Error('Portfolio error state (dev toggle)');
  if (state === 'denied') return <PermissionDeniedPage />;

  const workspaceId = context.workspace.id;
  const actor = { userId: context.user.id, workspaceId };
  const requested = first(query.portfolio);
  const filters = {
    stage: first(query.stage) || undefined,
    nextFrom: day(query.from),
    nextTo: day(query.to),
    adverseOnly: first(query.adverse) === '1',
  };

  let loaded: Loaded;
  try {
    const { inWorkspace, loadNotificationPreferences } = await import('@causedeck/core/runtime');
    const core = await import('@causedeck/core/portfolio');
    loaded = await inWorkspace(actor, async (tx): Promise<Loaded> => {
      const portfolios = await core.listPortfolios({ db: tx }, actor);
      const selected = portfolios.find((p) => p.id === requested) ?? portfolios[0] ?? null;
      let summary: PortfolioSummaryView | null = null;
      let cases: PortfolioCaseView[] = [];
      if (selected !== null) {
        summary = await core.portfolioSummary({ db: tx }, actor, { portfolioId: selected.id });
        const rows = await core.listPortfolioCases({ db: tx }, actor, {
          portfolioId: selected.id,
          ...(filters.stage === undefined ? {} : { stage: filters.stage }),
          ...(filters.nextFrom === undefined ? {} : { nextFrom: filters.nextFrom }),
          ...(filters.nextTo === undefined ? {} : { nextTo: filters.nextTo }),
          ...(filters.adverseOnly ? { adverseOnly: true } : {}),
        });
        cases = rows.map((row) => ({
          id: row.id,
          cnr: row.cnr,
          caseNumber: row.caseNumber,
          stage: row.status,
          nextDate: row.nextDate,
          lastAdverseOrderAt: row.lastAdverseOrderAt?.toISOString() ?? null,
          lastAdverseOrderRef: row.lastAdverseOrderRef,
        }));
      }
      return {
        portfolios: portfolios.map((p) => ({ id: p.id, name: p.name })),
        selected: selected === null ? null : { id: selected.id, name: selected.name },
        summary,
        cases,
        alertCells: [],
      };
    });
    const prefs = await loadNotificationPreferences(actor);
    loaded.alertCells = alertCells(prefs.preferences);
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
      if (error.code === 'FORBIDDEN') return <PermissionDeniedPage />;
      if (error.code === 'NOT_FOUND') notFound();
    }
    throw error;
  }

  const t = await getTranslations('portfolio');
  const isOwner = context.role === 'owner';
  const base = `/w/${encodeURIComponent(slug)}/portfolio`;
  const { selected, summary } = loaded;

  return (
    <div data-route="portfolio" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted max-w-prose text-sm">{t('description')}</p>
      </header>

      {loaded.portfolios.length > 1 ? (
        <nav aria-label={t('picker.label')} className="flex flex-wrap gap-2 text-sm">
          {loaded.portfolios.map((p) => (
            <a
              key={p.id}
              href={`${base}?portfolio=${p.id}`}
              aria-current={p.id === selected?.id ? 'page' : undefined}
              className={p.id === selected?.id ? 'font-medium underline' : 'text-accent'}
            >
              {p.name}
            </a>
          ))}
        </nav>
      ) : null}

      {selected === null || summary === null ? (
        <section data-pattern-state="empty" className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t('empty.title')}</h2>
          <p className="text-ink-muted max-w-prose text-sm">{t('empty.hint')}</p>
          {isOwner ? (
            <PortfolioCreateForm workspaceId={workspaceId} createAction={createPortfolioAction} />
          ) : (
            <p data-portfolio-read-only="" className="text-ink-muted text-xs">
              {t('readOnly')}
            </p>
          )}
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">{selected.name}</h2>
            <PortfolioExportButton
              workspaceId={workspaceId}
              portfolioId={selected.id}
              exportAction={exportPortfolioCsvAction}
            />
          </div>
          <PortfolioSummaryCards summary={summary} />
          <PortfolioFilters
            portfolioId={selected.id}
            values={filters}
            stages={summary.byStage.flatMap((row) => (row.stage === null ? [] : [row.stage]))}
            resetHref={`${base}?portfolio=${selected.id}`}
          />
          <PortfolioCaseTable cases={loaded.cases} />
          <section aria-label={t('import.title')} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t('import.title')}</h2>
            {isOwner ? (
              <PortfolioImportForm
                workspaceId={workspaceId}
                portfolioId={selected.id}
                importAction={importPortfolioAction}
              />
            ) : (
              <p data-portfolio-read-only="" className="text-ink-muted text-xs">
                {t('readOnly')}
              </p>
            )}
          </section>
          <section aria-label={t('alerts.title')} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t('alerts.title')}</h2>
            <PortfolioAlertSettings
              workspaceId={workspaceId}
              cells={loaded.alertCells}
              setPreference={setNotificationPreferenceAction}
            />
          </section>
        </>
      )}
    </div>
  );
}

function alertCells(preferences: readonly PreferenceView[]): PortfolioAlertCell[] {
  return preferences.flatMap((pref) =>
    // WhatsApp (#678) is linked in its own settings, not toggled per cell here.
    pref.channel !== 'whatsapp' &&
    (PORTFOLIO_ALERT_CATEGORIES as readonly string[]).includes(pref.category)
      ? [
          {
            category: pref.category as PortfolioAlertCell['category'],
            channel: pref.channel,
            enabled: pref.enabled,
            locked: pref.locked,
          },
        ]
      : [],
  );
}
