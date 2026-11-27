'use client';
// Fact-pattern search (#896, ADR 0051): the advocate describes the facts, the plan comes back as
// editable filter chips and the closest authorities as passages with role labels. Editing a chip
// searches again with exactly the edited plan (the `rerun` action never plans again); "Summarise with
// sources" asks for the optional answer, whose quotes the server has verified against the passages.
// Passages are anonymised text; a masked title is shown as withheld. Works on the mock providers.
import type { AuthoritySearchResult } from '@causedeck/core/research';
import { citableReference, courtLabel } from '@causedeck/intelligence/citation-display';
import { Button } from '@causedeck/ui/button';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode, type SyntheticEvent } from 'react';

import { judgmentHref, slugOf } from '../../lib/judgment-href.ts';

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

/**
 * The short name a lawyer writes for a corpus statute (#1194), keyed by the corpus name in lower
 * case without punctuation or the year. Labels only: the plan keeps the corpus name it filters on.
 */
const STATUTE_SHORT: Readonly<Record<string, string>> = {
  'indian penal code': 'IPC',
  'code of criminal procedure': 'CrPC',
  'code of civil procedure': 'CPC',
  'indian evidence act': 'Evidence Act',
  'bharatiya nyaya sanhita': 'BNS',
  'bharatiya nagarik suraksha sanhita': 'BNSS',
  'bharatiya sakshya adhiniyam': 'BSA',
  'constitution of india': 'Constitution',
  'scheduled castes and the scheduled tribes prevention of atrocities act': 'SC/ST Act',
  'scheduled castes and scheduled tribes prevention of atrocities act': 'SC/ST Act',
  'narcotic drugs and psychotropic substances act': 'NDPS Act',
  'protection of children from sexual offences act': 'POCSO Act',
  'unlawful activities prevention act': 'UAPA',
  'prevention of money laundering act': 'PMLA',
  'prevention of corruption act': 'PC Act',
  'negotiable instruments act': 'NI Act',
  'arbitration and conciliation act': 'Arbitration Act',
  'insolvency and bankruptcy code': 'IBC',
  'consumer protection act': 'CP Act',
  'motor vehicles act': 'MV Act',
  'transfer of property act': 'TP Act',
  'specific relief act': 'SR Act',
  'industrial disputes act': 'ID Act',
  'hindu marriage act': 'HMA',
  'protection of women from domestic violence act': 'DV Act',
  'right to information act': 'RTI Act',
  'information technology act': 'IT Act',
};

const statuteKey = (statute: string): string =>
  statute
    .toLowerCase()
    .replace(/[(),.]/g, ' ')
    .replace(/\b(18|19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words a statute name keeps in lower case after the first word ("Rent Control Act of Kerala"). */
const MINOR_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** The longest unknown-act label a chip shows; the full name stays in the chip's title (#1175). */
export const STATUTE_LABEL_MAX = 48;

/**
 * A chip's statute: the short name of a known act (`SC/ST Act`), else the name as written in the
 * corpus without a leading "The", capitalised like a title (minor words in lower case) and cut at a
 * word boundary to `STATUTE_LABEL_MAX` characters; abbreviations stay as the lawyer typed them.
 */
export const statuteLabel = (statute: string): string => {
  const short = STATUTE_SHORT[statuteKey(statute)];
  if (short !== undefined) return short;
  const words = statute
    .trim()
    .replace(/^the\s+/i, '')
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && MINOR_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.replace(/^[a-z]/, (c) => c.toUpperCase()),
    );
  const label = words.join(' ');
  if (label.length <= STATUTE_LABEL_MAX) return label;
  const cut = label.slice(0, STATUTE_LABEL_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > STATUTE_LABEL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

type Hit = AuthoritySearchResult['hits'][number];
type Segment = Hit['segments'][number];

/**
 * The passage a result card shows (#1175): the highest-scoring passage that is not headnote
 * furniture (the `header` role), else the first passage; the rest go behind "N more passages".
 */
export const bestSegment = (segments: readonly Segment[]): Segment | undefined =>
  segments.reduce<Segment | undefined>((best, segment) => {
    if (best === undefined) return segment;
    const bestHeader = best.role === 'header';
    const header = segment.role === 'header';
    if (bestHeader !== header) return header ? best : segment;
    return segment.score > best.score ? segment : best;
  }, undefined);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Passage text with the plan's keywords wrapped in `<mark>` (#1175). Built from React nodes, so the
 * untrusted corpus text is never parsed as HTML. Hard-wrapped lines are joined into one paragraph.
 */
export function highlight(text: string, keywords: readonly string[]): ReactNode[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  const terms = [...new Set(keywords.map((k) => k.trim().toLowerCase()))]
    .filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return [flat];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return flat
    .split(pattern)
    .map((part, index) =>
      index % 2 === 1 ? (
        <mark key={index} className="bg-accent text-accent-foreground rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    )
    .filter((part) => part !== '');
}

export function AuthoritySearch({
  workspaceId,
  initialQuery = '',
  subjectAreas,
  actions,
}: AuthoritySearchProps) {
  const t = useTranslations('research.search');
  // The passage card opens the judgment in the in-app reader (#1191), never the stored archive URL.
  const slug = slugOf(useParams());
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

  /** "Facts · p. 2"; headnote furniture (`header`) shows only its pages, never a "Header" label. */
  const segmentLabel = (segment: Segment): string => {
    const pages =
      segment.pageFrom === segment.pageTo
        ? t('results.page', { page: segment.pageFrom })
        : t('results.pages', { from: segment.pageFrom, to: segment.pageTo });
    return segment.role === 'header' ? pages : `${t(`roles.${segment.role}`)} · ${pages}`;
  };

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

  const chips: { key: string; label: string; title?: string; remove: () => void }[] = [];
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
        title: chip.statute,
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
                  className="flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-sm"
                >
                  <span className="truncate" title={chip.title}>
                    {chip.label}
                  </span>
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
          <h2 id="authority-results" className="font-medium">
            {t('results.heading')}{' '}
            <span className="text-muted-foreground text-sm font-normal">
              {t('results.count', { count: result.hits.length })}
            </span>
          </h2>

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
            <>
              <ol className="flex flex-col gap-3" data-slot="authority-results-list">
                {result.hits.map((hit, rank) => {
                  const first = hit.segments[0];
                  // One passage per card (#1175): the best non-header one, the rest collapsed.
                  const best = bestSegment(hit.segments);
                  const more = hit.segments.filter((segment) => segment !== best);
                  return (
                    <li
                      key={hit.judgmentId}
                      className="rounded-md border p-3 text-sm"
                      data-slot="authority-hit"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="font-medium">
                          {hit.title === null || hit.title === ''
                            ? t('results.maskedTitle')
                            : hit.title}
                        </h3>
                        {rank === 0 ? (
                          <span
                            className="text-muted-foreground rounded-full border px-2 text-xs"
                            data-slot="authority-best-match"
                          >
                            {t('results.bestMatch')}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground">
                        {[
                          citableReference(hit.neutralCitation, hit.caseNumbers),
                          courtLabel(hit.court),
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
                      {best === undefined ? null : (
                        <div className="mt-2 border-l-2 pl-2" data-slot="authority-snippet">
                          <p className="text-muted-foreground text-xs">{segmentLabel(best)}</p>
                          <p className="line-clamp-4">{highlight(best.text, plan?.keywords ?? [])}</p>
                        </div>
                      )}
                      {more.length === 0 ? null : (
                        <details className="mt-2" data-slot="authority-more">
                          <summary className="text-muted-foreground cursor-pointer text-xs">
                            {t('results.moreSegments', { count: more.length })}
                          </summary>
                          <ul className="mt-2 flex flex-col gap-2">
                            {more.map((segment) => (
                              <li key={segment.segmentId} className="border-l-2 pl-2">
                                <p className="text-muted-foreground text-xs">
                                  {segmentLabel(segment)}
                                </p>
                                <p>{highlight(segment.text, plan?.keywords ?? [])}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {slug === null ? null : (
                        <a
                          className="mt-2 inline-block underline"
                          href={judgmentHref(slug, hit.judgmentId, { page: first?.pageFrom })}
                        >
                          {t('results.openPdf')}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ol>
              {/* #1175: the summary is asked for after reading the results, so it sits below them. */}
              <div>
                <Button type="button" variant="outline" disabled={pending} onClick={summarise}>
                  {pending ? t('answer.working') : t('answer.button')}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
