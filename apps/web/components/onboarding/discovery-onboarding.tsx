'use client';
// Zero-entry onboarding (#501, D-048): identifiers, then courts, then a live progress line, then the
// one confirm grid of the bootstrap import, then the court-day view. A name-only identity is shown
// sample matters to confirm before anything is staged; nothing is saved before the confirm grid.
import type { ImportPlan } from '@causedeck/core/import';
import type { DiscoveryOutcome, DiscoverySample } from '@causedeck/core/onboarding';
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Textarea } from '@causedeck/ui/textarea';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  applyImportPlanAction,
  getImportPlanAction,
  saveImportPlanEditsAction,
  undoImportBatchAction,
  type ApplyView,
} from '../../app/(app)/w/[slug]/import/actions.ts';
import {
  discoverAdvocateCasesAction,
  recordOnboardingStepAction,
} from '../../app/(app)/w/[slug]/onboarding/actions.ts';
import { confirmImport, type ConfirmInput } from '../../lib/import/plan-edit.ts';
import { ConfirmGrid } from '../import/confirm-grid.tsx';

export interface DiscoveryCourt {
  sourceId: string;
  labelKey: 'madrasHc' | 'karnatakaHc' | 'tnDistrict';
}

export interface DiscoveryOnboardingProps {
  workspaceId: string;
  courts: readonly DiscoveryCourt[];
}

type Phase = 'identifiers' | 'courts' | 'searching' | 'disambiguate' | 'review';
type Counts = DiscoveryOutcome['counts'];

const COURT_LABELS = {
  madrasHc: 'courts.madrasHc',
  karnatakaHc: 'courts.karnatakaHc',
  tnDistrict: 'courts.tnDistrict',
} as const;

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export function DiscoveryOnboarding({ workspaceId, courts }: DiscoveryOnboardingProps) {
  const t = useTranslations('onboardingDiscovery');
  const courtDayHref = usePathname().replace(/\/onboarding\/?$/, '/today');
  const [phase, setPhase] = useState<Phase>('identifiers');
  const [enrolment, setEnrolment] = useState('');
  const [names, setNames] = useState('');
  const [selected, setSelected] = useState<string[]>(courts.map((court) => court.sourceId));
  const [counts, setCounts] = useState<Counts | null>(null);
  const [samples, setSamples] = useState<DiscoverySample[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [empty, setEmpty] = useState(false);

  const identifiers = { enrolmentNumbers: lines(enrolment), names: lines(names) };
  const hasIdentifiers = identifiers.enrolmentNumbers.length + identifiers.names.length > 0;

  async function search(confirmedMatchKeys?: string[]) {
    setFailed(false);
    setEmpty(false);
    setPhase('searching');
    const result = await discoverAdvocateCasesAction({
      workspaceId,
      sourceIds: selected,
      ...identifiers,
      ...(confirmedMatchKeys === undefined ? {} : { confirmedMatchKeys }),
    }).catch(() => null);
    if (result?.ok !== true) {
      setFailed(true);
      setPhase('courts');
      return;
    }
    const outcome = result.data;
    setCounts(outcome.counts);
    if (outcome.status === 'needs_disambiguation') {
      setSamples(outcome.samples);
      setCandidates(outcome.candidateEnrolments);
      setPicked([]);
      setPhase('disambiguate');
    } else if (outcome.status === 'nothing_found') {
      setEmpty(true);
      setPhase('courts');
    } else {
      const loaded = await getImportPlanAction({ workspaceId, batchId: outcome.batchId }).catch(
        () => null,
      );
      if (loaded?.ok !== true) {
        setFailed(true);
        setPhase('courts');
        return;
      }
      setBatchId(outcome.batchId);
      setPlan(loaded.data);
      setPhase('review');
    }
  }

  const confirm = async (input: ConfirmInput) => {
    if (plan === null || batchId === null) throw new Error('no plan to confirm');
    const result = await confirmImport<ApplyView>(input, {
      plan,
      savePlan: (groups) => saveImportPlanEditsAction({ workspaceId, batchId, groups }),
      applyPlan: (decisions) => applyImportPlanAction({ workspaceId, batchId, decisions }),
    });
    if (result.ok) {
      void recordOnboardingStepAction({
        workspaceId,
        step: 'confirm_grid_done',
        discovered: plan.matters.length,
        confirmed: result.data.created.matters ?? 0,
      });
    }
    return result;
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <div data-slot="onboarding-discovery" className="flex flex-col gap-4">
      {failed ? (
        <Alert tone="danger" data-pattern-state="error">
          <p>{t('error.action')}</p>
        </Alert>
      ) : null}
      {empty ? <Alert tone="info">{t('nothingFound')}</Alert> : null}
      {phase === 'identifiers' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t('identifiers.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('identifiers.body')}</p>
          <label className="grid gap-1 text-sm">
            {t('identifiers.enrolment')}
            <Textarea
              value={enrolment}
              rows={2}
              onChange={(e) => {
                setEnrolment(e.target.value);
              }}
            />
          </label>
          <label className="grid gap-1 text-sm">
            {t('identifiers.names')}
            <Textarea
              value={names}
              rows={2}
              onChange={(e) => {
                setNames(e.target.value);
              }}
            />
          </label>
          <Button
            type="button"
            disabled={!hasIdentifiers}
            onClick={() => {
              setPhase('courts');
            }}
          >
            {t('identifiers.next')}
          </Button>
        </section>
      ) : null}
      {phase === 'courts' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t('courts.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('courts.body')}</p>
          {courts.map((court) => (
            <label key={court.sourceId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(court.sourceId)}
                onChange={() => {
                  setSelected(toggle(selected, court.sourceId));
                }}
              />
              {t(COURT_LABELS[court.labelKey])}
            </label>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhase('identifiers');
              }}
            >
              {t('courts.back')}
            </Button>
            <Button type="button" disabled={selected.length === 0} onClick={() => void search()}>
              {t('courts.search')}
            </Button>
          </div>
        </section>
      ) : null}
      {phase === 'searching' ? (
        <p role="status" aria-live="polite" className="text-sm">
          {t('progress.searching', { courts: selected.length })}
        </p>
      ) : null}
      {phase === 'disambiguate' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t('disambiguate.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('disambiguate.body')}</p>
          {counts === null ? null : (
            <p role="status" className="text-sm">
              {t('progress.found', { listings: counts.listings, courts: counts.courts })}
            </p>
          )}
          {candidates.length > 0 ? (
            <p className="text-sm">
              {t('disambiguate.enrolments', { list: candidates.join(', ') })}
            </p>
          ) : null}
          {samples.map((sample) => (
            <label key={sample.matchKey} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(sample.matchKey)}
                onChange={() => {
                  setPicked(toggle(picked, sample.matchKey));
                }}
              />
              {[sample.label, sample.parties].filter(Boolean).join(' · ')}
            </label>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhase('identifiers');
              }}
            >
              {t('disambiguate.addEnrolment')}
            </Button>
            <Button
              type="button"
              disabled={picked.length === 0}
              onClick={() => void search(picked)}
            >
              {t('disambiguate.confirm', { count: picked.length })}
            </Button>
          </div>
        </section>
      ) : null}
      {phase === 'review' && plan !== null && batchId !== null ? (
        <div
          onClickCapture={(event) => {
            const link = (event.target as HTMLElement).closest('a');
            if (link?.getAttribute('href') === courtDayHref) {
              void recordOnboardingStepAction({ workspaceId, step: 'first_court_day_view' });
            }
          }}
        >
          {counts === null ? null : (
            <p role="status" className="mb-3 text-sm">
              {t('progress.found', { listings: counts.listings, courts: counts.courts })}
            </p>
          )}
          <ConfirmGrid
            plan={plan}
            courtDayHref={courtDayHref}
            onConfirm={confirm}
            onUndo={() => undoImportBatchAction({ workspaceId, batchId })}
            onAddIdentifiers={() => {
              setPhase('identifiers');
            }}
            onRetryFile={() => void search()}
            onKeepFile={() => undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
