// `/w/[slug]/insights/report` (#85): the printable practice report. A4, ink on white, the hero rate,
// obligation health, the preparedness and load changes and the definitions, with no chart (a table
// prints more faithfully) and no data from any other workspace. Printing is the only export.
import { formatDate } from '@causedeck/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { PermissionDeniedPage } from '../../../../../../components/shell/permission-denied-page.tsx';
import { requireWorkspaceFlag } from '../../../../../../lib/flags.ts';
import { loadInsights, parseInsightsQuery } from '../../../../../../lib/insights/insights-deps.ts';
import { can } from '../../../../../../lib/workspace-context.ts';
import { getWorkspaceContext } from '../../../../../../lib/workspace-loader.ts';
import { deltaOf, percent } from '../_components/format.ts';

import { PrintButton } from './print-button.tsx';

interface ReportPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('insights');
  return { title: t('report.title') };
}

const A4 =
  '@page { size: A4; margin: 16mm; } @media print { body { background: #fff !important; color: #000 !important; } }';

export default async function InsightsReportPage({ params, searchParams }: ReportPageProps) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const context = await getWorkspaceContext(slug);
  if (!context) notFound();
  await requireWorkspaceFlag('insights.enabled', context);
  if (!can(context.role, 'insights.read')) return <PermissionDeniedPage />;
  const load = await loadInsights(context, parseInsightsQuery(search));
  if (load.kind === 'denied') return <PermissionDeniedPage />;
  if (load.kind === 'error') throw new Error('Could not compute the practice report');

  const [t, localeName] = await Promise.all([getTranslations('insights'), getLocale()]);
  const locale = localeName;
  const { preparedKept: pk, obligations: ob, preparedness: pr, load: ld } = load.data;
  const day = (d: string) => formatDate(`${d}T12:00:00+05:30`, { locale });
  const change = (delta: number | null) => {
    const d = deltaOf(delta);
    return t(d.key, { value: d.value });
  };
  const pct = (rate: number | null) => (rate === null ? '-' : `${String(percent(rate))}%`);
  return (
    <article
      data-route="insights-report"
      className="mx-auto flex max-w-[190mm] flex-col gap-6 bg-white p-4 text-black print:p-0"
    >
      <style>{A4}</style>
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium">{t('report.title')}</h1>
          <p className="text-sm">
            {t('range.window', { from: day(pk.window.from), to: day(pk.window.to) })}
          </p>
          <p className="text-sm">
            {load.data.scope === 'own' ? t('scopeOwn') : t('scopeWorkspace')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 print:hidden">
          <PrintButton />
          <Link href={`/w/${slug}/insights`} className="text-sm underline underline-offset-4">
            {t('report.back')}
          </Link>
        </div>
      </header>
      <section aria-labelledby="r-hero" className="flex flex-col gap-1 border-y border-black py-4">
        <h2 id="r-hero" className="text-sm font-medium">
          {t('hero.label')}
        </h2>
        <p className="font-serif text-5xl font-medium tabular-nums">
          {pk.rate === null ? '-' : `${String(percent(pk.rate))}%`}
        </p>
        <p className="text-sm">
          {pk.rate === null
            ? t('hero.noRate')
            : pk.previous.rate === null
              ? t('hero.summaryAlone', { percent: percent(pk.rate), n: pk.denominator })
              : t('hero.summary', {
                  percent: percent(pk.rate),
                  n: pk.denominator,
                  previous: percent(pk.previous.rate),
                })}
        </p>
      </section>
      <section aria-labelledby="r-ob" className="flex flex-col gap-2">
        <h2 id="r-ob" className="text-sm font-medium">
          {t('obligations.title')}
        </h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {(
              [
                [t('obligations.due'), String(ob.due)],
                [t('obligations.kept'), String(ob.kept)],
                [t('obligations.missedRate'), pct(ob.missedRate)],
                [t('obligations.captureCompleteness'), pct(ob.captureCompleteness)],
                [t('obligations.reschedules'), String(ob.deliberateReschedules)],
              ] as const
            ).map(([label, value]) => (
              <tr key={label} className="border-b border-black/30">
                <th scope="row" className="py-1 text-left font-normal">
                  {label}
                </th>
                <td className="py-1 text-right tabular-nums">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="r-pr" className="flex flex-col gap-1">
        <h2 id="r-pr" className="text-sm font-medium">
          {t('preparedness.title')}
        </h2>
        <p className="text-sm">
          {pr.hidden
            ? t('preparedness.hidden', { n: pr.n })
            : `${t('preparedness.summary', { average: (pr.average ?? 0).toFixed(1), n: pr.n })} ${change(pr.delta)}`}
        </p>
      </section>
      <section aria-labelledby="r-ld" className="flex flex-col gap-1">
        <h2 id="r-ld" className="text-sm font-medium">
          {t('load.title')}
        </h2>
        <p className="text-sm">
          {ld.hidden
            ? t('load.hidden', { n: ld.n })
            : `${t('load.summary', { demand: (ld.demand ?? 0).toFixed(1), worry: (ld.worry ?? 0).toFixed(1), effort: (ld.effort ?? 0).toFixed(1), n: ld.n })} ${change(ld.delta)}`}
        </p>
      </section>
      <section
        aria-labelledby="r-def"
        className="flex flex-col gap-2 border-t border-black pt-4 text-xs"
      >
        <h2 id="r-def" className="text-sm font-medium">
          {t('report.definitions')}
        </h2>
        <p>{t('hero.definition')}</p>
        <p>{t('report.missedDefinition')}</p>
        <p>{t('report.baselineDefinition')}</p>
        <p>{t('report.private')}</p>
      </section>
    </article>
  );
}
