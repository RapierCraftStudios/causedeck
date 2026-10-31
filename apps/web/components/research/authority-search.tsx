'use client';
// Fact-pattern search (#896, ADR 0051): the advocate describes the facts, the plan comes back as
// editable filter chips and the closest authorities as passages with role labels. Editing a chip
// searches again with exactly the edited plan (the `rerun` action never plans again); "Summarise with
// sources" asks for the optional answer, whose quotes the server has verified against the passages.
// Passages are anonymised text; a masked title is shown as withheld. Works on the mock providers.
import type { AuthoritySearchResult } from '@causedeck/core/research';
import { Button } from '@causedeck/ui/button';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition, type SyntheticEvent } from 'react';

type Plan = AuthoritySearchResult['plan'];
type ActionResult =
  { ok: true; data: AuthoritySearchResult } | { ok: false; error: { message: string } };
type SearchAction = (raw: unknown) => Promise<ActionResult>;

export interface AuthoritySearchActions {
  search: SearchAction;
  rerun: SearchAction;
}

export interface AuthoritySearchProps {
  workspaceId: string;
  initialQuery?: string;
  /** The subject areas a chip may name (the corpus vocabulary). */
  subjectAreas: readonly string[];
  actions: AuthoritySearchActions;
}

const LEVELS = ['supreme_court', 'high_court', 'other'] as const;
const OUTCOMES = ['allowed', 'partly_allowed', 'dismissed', 'remanded', 'disposed'] as const;

const levelOf = (value: string | null): (typeof LEVELS)[number] =>
  value === 'supreme_court' || value === 'high_court' ? value : 'other';

/** `indian penal code` shown as written in the corpus; the abbreviations stay as the lawyer typed them. */
const statuteLabel = (statute: string): string =>
  statute.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function AuthoritySearch({
  workspaceId,
  initialQuery = '',
  subjectAreas,
  actions,
}: AuthoritySearchProps) {
  const t = useTranslations('research.search');
  const format = useFormatter();
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<AuthoritySearchResult | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answerFailed, setAnswerFailed] = useState(false);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ statute: '', section: '', court: '', from: '', to: '' });

  const date = (iso: string): string =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });

  function run(call: () => Promise<ActionResult>, nextPlan?: Plan): void {
    start(async () => {
      const response = await call();
      if (response.ok) {
        setError(null);
        setResult(response.data);
        setPlan(response.data.plan);
        setAnswerFailed(response.data.answerFailed);
      } else {
        // Keep the edit on screen even when the refresh failed, so it is not lost.
        if (nextPlan !== undefined) setPlan(nextPlan);
        setError(response.error.message);
      }
    });
  }

  function onSearch(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = query.trim();
    if (text === '') return;
    run(() => actions.search({ workspaceId, query: text }));
  }

  function edit(next: Plan): void {
    setPlan(next);
    run(() => actions.rerun({ workspaceId, plan: next }), next);
  }

  function summarise(): void {
    if (plan === null) return;
    run(() => actions.rerun({ workspaceId, plan, answer: true }), plan);
  }

  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (plan !== null) {
    for (const area of plan.subjectAreas) {
      chips.push({
        key: `subject:${area}`,
        label: t(`subjects.${area}`),
        remove: () => {
          edit({ ...plan, subjectAreas: plan.subjectAreas.filter((a) => a !== area) });
        },
      });
    }
    for (const chip of result?.chips ?? []) {
      const counterpart = chip.counterparts[0];
      chips.push({
        key: `statute:${chip.statute}:${chip.section}`,
        label:
          t('filters.statute', {
            statute: statuteLabel(chip.statute),
            section: chip.section.toUpperCase(),
          }) +
          (counterpart === undefined
            ? ''
            : ` (${t('filters.alsoIn', { statute: statuteLabel(counterpart.statute), section: counterpart.section.toUpperCase() })})`),
        remove: () => {
          edit({
            ...plan,
            statutes: plan.statutes.filter(
              (s) => !(s.statute === chip.statute && s.section === chip.section),
            ),
          });
        },
      });
    }
    for (const court of plan.courts) {
      chips.push({
        key: `court:${court}`,
        label: t('filters.court', { court }),
        remove: () => {
          edit({ ...plan, courts: plan.courts.filter((c) => c !== court) });
        },
      });
    }
    if (plan.courtLevel !== null) {
      chips.push({
        key: 'level',
        label: t('filters.level', { level: t(`levels.${levelOf(plan.courtLevel)}`) }),
        remove: () => {
          edit({ ...plan, courtLevel: null });
        },
      });
    }
    if (plan.outcome !== null) {
      chips.push({
        key: 'outcome',
        label: t('filters.outcome', { outcome: t(`outcomes.${plan.outcome}`) }),
        remove: () => {
          edit({ ...plan, outcome: null });
        },
      });
    }
    if (plan.dateFrom !== null) {
      chips.push({
        key: 'from',
        label: t('filters.from', { date: date(plan.dateFrom) }),
        remove: () => {
          edit({ ...plan, dateFrom: null });
        },
      });
    }
    if (plan.dateTo !== null) {
      chips.push({
        key: 'to',
        label: t('filters.to', { date: date(plan.dateTo) }),
        remove: () => {
          edit({ ...plan, dateTo: null });
        },
      });
    }
  }

  const select = 'rounded border px-2 py-1 text-sm';
  const answer = result?.answer ?? null;
  const usage = result?.usage;

  return (
    <div className="flex flex-col gap-6" data-slot="authority-search">
      <form onSubmit={onSearch} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('queryLabel')}
          <textarea
            name="query"
            rows={4}
            maxLength={4000}
            required
            value={query}
            placeholder={t('queryPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="rounded border px-2 py-1 font-normal"
          />
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || query.trim() === ''}>
            {pending ? t('searching') : t('submit')}
          </Button>
          {usage === undefined ? null : (
            <span className="text-muted-foreground text-xs" data-slot="authority-usage">
              {usage.limit === null
                ? t('usageUnlimited', { used: usage.used })
                : t('usage', { used: usage.used, limit: usage.limit })}
            </span>
          )}
        </div>
      </form>

      {error === null ? null : (
        <p role="alert" data-slot="authority-error" className="text-sm text-red-600">
          {error === '' ? t('error') : error}
        </p>
      )}

      {plan === null ? null : (
        <section aria-labelledby="authority-filters" className="flex flex-col gap-2">
          <h2 id="authority-filters" className="font-medium">
            {t('filters.heading')}
          </h2>
          <p className="text-muted-foreground text-xs">{t('filters.hint')}</p>
          {chips.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('filters.none')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2" data-slot="authority-chips">
              {chips.map((chip) => (
                <li
                  key={chip.key}
                  className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm"
                >
                  <span>{chip.label}</span>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={t('filters.remove', { label: chip.label })}
                    onClick={chip.remove}
                    className="px-1"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer">{t('filters.addHeading')}</summary>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                {t('filters.subjectLabel')}
                <select
                  className={select}
                  value=""
                  disabled={pending}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value !== '' && !plan.subjectAreas.some((a) => a === value)) {
                      edit({
                        ...plan,
                        subjectAreas: [...plan.subjectAreas, value as Plan['subjectAreas'][number]],
                      });
                    }
                  }}
                >
                  <option value="">{t('filters.choose')}</option>
                  {subjectAreas.map((area) => (
                    <option key={area} value={area}>
                      {t(`subjects.${area as Plan['subjectAreas'][number]}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                {t('filters.levelLabel')}
                <select
                  className={select}
                  value=""
                  disabled={pending}
                  onChange={(event) => {
                    if (event.target.value !== '') {
                      edit({ ...plan, courtLevel: levelOf(event.target.value) });
                    }
                  }}
                >
                  <option value="">{t('filters.choose')}</option>
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {t(`levels.${level}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                {t('filters.outcomeLabel')}
                <select
                  className={select}
                  value=""
                  disabled={pending}
                  onChange={(event) => {
                    const value = OUTCOMES.find((o) => o === event.target.value);
                    if (value !== undefined) edit({ ...plan, outcome: value });
                  }}
                >
                  <option value="">{t('filters.choose')}</option>
                  {OUTCOMES.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {t(`outcomes.${outcome}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                {t('filters.statuteLabel')}
                <input
                  className={select}
                  value={draft.statute}
                  maxLength={200}
                  onChange={(event) => {
                    setDraft({ ...draft, statute: event.target.value });
                  }}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t('filters.sectionLabel')}
                <input
                  className={`${select} w-24`}
                  value={draft.section}
                  maxLength={50}
                  onChange={(event) => {
                    setDraft({ ...draft, section: event.target.value });
                  }}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={pending || draft.statute.trim() === '' || draft.section.trim() === ''}
                onClick={() => {
                  edit({
                    ...plan,
                    statutes: [
                      ...plan.statutes,
                      { statute: draft.statute.trim(), section: draft.section.trim() },
                    ],
                  });
                  setDraft({ ...draft, statute: '', section: '' });
                }}
              >
                {t('filters.add')}
              </Button>
              <label className="flex flex-col gap-1">
                {t('filters.courtLabel')}
                <input
                  className={`${select} w-28 uppercase`}
                  value={draft.court}
                  maxLength={12}
                  onChange={(event) => {
                    setDraft({ ...draft, court: event.target.value });
                  }}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !/^[A-Za-z][A-Za-z0-9-]{1,11}$/.test(draft.court.trim())}
                onClick={() => {
                  edit({ ...plan, courts: [...plan.courts, draft.court.trim().toUpperCase()] });
                  setDraft({ ...draft, court: '' });
                }}
              >
                {t('filters.add')}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                {t('filters.fromLabel')}
                <input
                  type="date"
                  className={select}
                  value={draft.from}
                  onChange={(event) => {
                    setDraft({ ...draft, from: event.target.value });
                  }}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t('filters.toLabel')}
                <input
                  type="date"
                  className={select}
                  value={draft.to}
                  onChange={(event) => {
                    setDraft({ ...draft, to: event.target.value });
                  }}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={pending || (draft.from === '' && draft.to === '')}
                onClick={() => {
                  edit({
                    ...plan,
                    dateFrom: draft.from === '' ? plan.dateFrom : draft.from,
                    dateTo: draft.to === '' ? plan.dateTo : draft.to,
                  });
                  setDraft({ ...draft, from: '', to: '' });
                }}
              >
                {t('filters.add')}
              </Button>
            </div>
          </details>
        </section>
      )}

      {result === null ? null : (
        <section
          aria-labelledby="authority-results"
          className="flex flex-col gap-3"
          aria-busy={pending}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="authority-results" className="font-medium">
              {t('results.heading')}{' '}
              <span className="text-muted-foreground text-sm font-normal">
                {t('results.count', { count: result.hits.length })}
              </span>
            </h2>
            {result.hits.length === 0 ? null : (
              <Button type="button" variant="outline" disabled={pending} onClick={summarise}>
                {pending ? t('answer.working') : t('answer.button')}
              </Button>
            )}
          </div>

          {answerFailed ? (
            <p role="status" data-slot="authority-answer-failed" className="text-sm">
              {t('answer.failed')}
            </p>
          ) : null}
          {answer === null ? null : (
            <div className="rounded-md border p-3 text-sm" data-slot="authority-answer">
              <h3 className="font-medium">{t('answer.heading')}</h3>
              <p className="text-muted-foreground text-xs">{t('answer.hint')}</p>
              {answer.noAuthority ? (
                <p className="mt-2">{t('answer.none')}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {answer.claims.map((claim, index) => (
                    <li key={`${claim.segmentId}:${String(index)}`} data-verified={claim.verified}>
                      <p>{claim.statement}</p>
                      <blockquote className="text-muted-foreground border-l-2 pl-2">
                        {claim.quote}
                      </blockquote>
                      <p
                        className={claim.verified ? 'text-xs' : 'text-xs font-medium text-red-600'}
                      >
                        {claim.verified ? t('answer.verified') : t('answer.unsupported')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result.hits.length === 0 ? (
            <p data-slot="authority-empty" className="text-muted-foreground text-sm">
              {t('results.empty')}
            </p>
          ) : (
            <ol className="flex flex-col gap-3" data-slot="authority-results-list">
              {result.hits.map((hit) => {
                const first = hit.segments[0];
                return (
                  <li key={hit.judgmentId} className="rounded-md border p-3 text-sm">
                    <h3 className="font-medium">
                      {hit.title === null || hit.title === ''
                        ? t('results.maskedTitle')
                        : hit.title}
                    </h3>
                    <p className="text-muted-foreground">
                      {[
                        hit.neutralCitation,
                        hit.court,
                        t(`levels.${levelOf(hit.courtLevel)}`),
                        hit.judgmentDate === null
                          ? null
                          : t('results.decided', { date: date(hit.judgmentDate) }),
                      ]
                        .filter((part): part is string => part !== null && part !== '')
                        .join(' · ')}
                    </p>
                    <p className="text-muted-foreground">
                      {t('results.outcome', { outcome: t(`outcomes.${hit.outcome}`) })}
                      {' · '}
                      {hit.citedByCount === 0
                        ? t('results.notCited')
                        : t('results.citedBy', { count: hit.citedByCount })}
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {hit.segments.map((segment) => (
                        <li key={segment.segmentId} className="border-l-2 pl-2">
                          <p className="text-muted-foreground text-xs">
                            {t(`roles.${segment.role}`)}
                            {' · '}
                            {segment.pageFrom === segment.pageTo
                              ? t('results.page', { page: segment.pageFrom })
                              : t('results.pages', { from: segment.pageFrom, to: segment.pageTo })}
                          </p>
                          <p className="whitespace-pre-wrap">{segment.text}</p>
                        </li>
                      ))}
                    </ul>
                    {hit.sourceUrl === null || first === undefined ? null : (
                      <a
                        className="mt-2 inline-block underline"
                        href={`${hit.sourceUrl}#page=${String(first.pageFrom)}`}
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        {t('results.openPdf')}
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
