'use client';
// The grounded matter copilot (#1115, ADR 0051, D-004), rebuilt as a conversation (#1168): a thread of
// turns (the question, then the written answer; follow-ups append and earlier turns stay), each answer
// with numbered citation chips into its verified sources (copilot-answer.tsx), the sources in a rail
// from `lg` up and a Sheet below it, and a composer (auto-grow, Enter sends, Shift+Enter is a new line,
// the usage line and the matter's context chips). Before the first question it suggests 3-4 questions
// built from the matter. States: a loading skeleton while it searches, an error or the plan limit
// with a retry (the retry reuses the turn's request id, so it counts once), no authority found, AI off
// for a sensitive matter, and offline (nothing is sent). A claim the server could not verify is only
// in the collapsed "Not verified" group, never in the answer; a failed call is never an answer.
// #1144: with `drafts` and `insert` (matter copilot, a member who may write drafts), a verified
// judgment claim has "Insert into draft": the member picks a draft and the block to insert after; the
// claim's judgment, quote and pinpoint go to the server unaltered, which verifies them again.
// #1192: a citation chip scrolls to its source (in the rail, or the Sheet below `lg`) and keeps it
// highlighted. "No authority found" and "the sources don't settle this" (no claim verified, some
// unverified) show the reason and next steps: search Research for the question (prefilled), rephrase
// (the question goes back into the composer) and, in the workspace copilot, ask with a matter.
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { Textarea } from '@causedeck/ui/textarea';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import {
  AnswerProse,
  sourceElementId,
  SourcesList,
  SourcesSheet,
  type CopilotClaim,
} from './copilot-answer.tsx';

type ActionResult =
  { ok: true; data: CopilotAnswer } | { ok: false; error: { code?: string; message: string } };

/** A draft of this matter a claim can be inserted into: its latest version and its blocks. */
export interface CopilotDraftTarget {
  id: string;
  title: string;
  versionId: string;
  href: string;
  blocks: { key: string; label: string }[];
}

export interface CopilotInsertRef {
  judgmentId: string;
  quote: string;
  para?: number;
  page?: number;
}

type InsertResult = { ok: true; data: unknown } | { ok: false; error: { code?: string } };

type Claim = CopilotAnswer['claims'][number];

/** The pinpoint a verified judgment claim carries (paragraph first), or null when it is not one. */
function insertRef(claim: Claim): CopilotInsertRef | null {
  if (claim.kind !== 'seg' || claim.judgmentId === null) return null;
  const { paragraph, page } = claim.pinpoint;
  if (paragraph !== null)
    return { judgmentId: claim.judgmentId, quote: claim.quote, para: paragraph };
  if (page !== null) return { judgmentId: claim.judgmentId, quote: claim.quote, page };
  return null;
}

function InsertIntoDraft({
  workspaceId,
  drafts,
  refOf,
  insert,
}: {
  workspaceId: string;
  drafts: readonly CopilotDraftTarget[];
  refOf: CopilotInsertRef;
  insert: (raw: unknown) => Promise<InsertResult>;
}) {
  const t = useTranslations('drafting.copilotInsert');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftId, setDraftId] = useState(drafts[0]?.id ?? '');
  const target = drafts.find((d) => d.id === draftId) ?? drafts[0];
  const [after, setAfter] = useState<string | null>(null);
  const afterKey = after ?? target?.blocks.at(-1)?.key ?? '';
  const [outcome, setOutcome] = useState<'inserted' | 'conflict' | 'failed' | null>(null);
  const [pending, start] = useTransition();

  if (target === undefined) return null;
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 self-start"
          onClick={() => {
            setOpen(true);
            setOutcome(null);
          }}
        >
          {t('insert')}
        </Button>
        {outcome === 'inserted' ? (
          <p role="status" data-slot="copilot-inserted" className="text-xs">
            {t('inserted')}{' '}
            <a href={target.href} className="underline">
              {t('openDraft')}
            </a>
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div data-slot="copilot-insert" className="flex flex-col gap-2 rounded border p-2">
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t('draft')}
        <select
          value={target.id}
          onChange={(event) => {
            setDraftId(event.target.value);
            setAfter(null);
          }}
          className="min-h-11 rounded border px-2 font-normal"
        >
          {drafts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t('after')}
        <select
          value={afterKey}
          onChange={(event) => {
            setAfter(event.target.value);
          }}
          className="min-h-11 rounded border px-2 font-normal"
        >
          {target.blocks.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          disabled={pending || afterKey === ''}
          onClick={() => {
            start(async () => {
              const result = await insert({
                workspaceId,
                draftId: target.id,
                versionId: target.versionId,
                afterBlockId: afterKey,
                candidateRef: refOf,
              });
              if (result.ok) {
                setOutcome('inserted');
                setOpen(false);
                setAfter(null);
                // The draft has a new version: reload the targets so the next insert lands on it.
                router.refresh();
              } else setOutcome(result.error.code === 'CONFLICT' ? 'conflict' : 'failed');
            });
          }}
        >
          {pending ? t('inserting') : t('confirm')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('cancel')}
        </Button>
      </div>
      {outcome === 'conflict' || outcome === 'failed' ? (
        <p role="alert" className="text-xs text-red-600">
          {t(outcome)}
        </p>
      ) : null}
    </div>
  );
}

/** What the matter page knows about the matter, for the context chips and the suggested questions. */
export interface CopilotMatterContext {
  title: string;
  /** The stage of the next listing, if any. */
  stage: string | null;
  /** The next date (`YYYY-MM-DD`), if any. */
  nextDate: string | null;
}

/** One question and what came of it. */
export interface CopilotTurn {
  id: string;
  /** Null for a stored answer shown without its question (stories, tests). */
  question: string | null;
  /** Reused by a retry, so the question counts once. */
  requestId: string;
  state: 'pending' | 'answered' | 'failed';
  answer?: CopilotAnswer;
  /** `planLimit`: the plan's monthly cap or the preview plan is unavailable (the action's CONFLICT). */
  failure?: { planLimit: boolean; message: string };
}

const subscribeOnline = (notify: () => void): (() => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

/** False while the browser is offline; true on the server. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

const isDesktop = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 64rem)').matches;

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scrolls to the element once it exists (the rail switches turn or the Sheet mounts first) and focuses
 * its open-at-the-passage link when it has one.
 */
function scrollToWhenShown(id: string, tries = 10): void {
  const el = document.getElementById(id);
  if (el !== null) {
    // jsdom has no scrollIntoView.
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    // #1192: focus the source's link that opens the judgment at the passage, one Enter away.
    el.querySelector<HTMLElement>('[data-slot="copilot-source-link"]')?.focus({
      preventScroll: true,
    });
    return;
  }
  if (tries > 0) {
    requestAnimationFrame(() => {
      scrollToWhenShown(id, tries - 1);
    });
  }
}

/** "No authority found" or "the sources don't settle this": the reason and the next steps. */
function NextSteps({
  slot,
  title,
  reason,
  question,
  researchHref,
  matterHref,
  onRephrase,
}: {
  slot: string;
  title: string;
  reason: string;
  question: string | null;
  researchHref: string;
  matterHref: string | null;
  onRephrase: (() => void) | null;
}) {
  const t = useTranslations('research.copilot');
  return (
    <div
      data-slot={`${slot}-state`}
      className="border-line bg-surface-raised flex flex-col gap-3 rounded-md border p-3"
    >
      <div role="status" className="flex flex-col gap-1 text-sm">
        <p data-slot={slot} className="text-ink font-medium">
          {title}
        </p>
        <p data-slot="copilot-state-reason" className="text-ink-muted">
          {reason}
        </p>
      </div>
      <ul
        data-slot="copilot-next-steps"
        aria-label={t('nextSteps.label')}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        {question === null ? null : (
          <li>
            <Button asChild variant="secondary" size="sm" className="min-h-11 w-full sm:w-auto">
              <Link href={researchHref} data-slot="copilot-search-research">
                <span className="truncate">
                  {t('nextSteps.searchResearch', { query: question })}
                </span>
              </Link>
            </Button>
          </li>
        )}
        {onRephrase === null ? null : (
          <li>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-slot="copilot-rephrase"
              className="min-h-11 w-full sm:w-auto"
              onClick={onRephrase}
            >
              {t('nextSteps.rephrase')}
            </Button>
          </li>
        )}
        {matterHref === null ? null : (
          <li>
            <Button asChild variant="ghost" size="sm" className="min-h-11 w-full sm:w-auto">
              <Link href={matterHref} data-slot="copilot-ask-with-matter">
                {t('nextSteps.askWithMatter')}
              </Link>
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}

export interface CopilotPanelProps {
  workspaceId: string;
  /** #1192: links of the next steps (`/w/<slug>/research?q=`, `/w/<slug>/matters`). */
  workspaceSlug: string;
  /** Omitted (or undefined) for the workspace-level copilot. */
  matterId?: string | undefined;
  ask: (raw: unknown) => Promise<ActionResult>;
  /** Renders a stored result (stories, tests). */
  initialAnswer?: CopilotAnswer;
  /** Renders a stored thread (stories, tests); takes precedence over `initialAnswer`. */
  initialTurns?: readonly CopilotTurn[];
  /** The matter's title, stage and next date (matter copilot); fail-soft, may be absent. */
  matterContext?: CopilotMatterContext;
  /** Forces the offline state (stories); otherwise the browser's online status decides. */
  offline?: boolean;
  /** #1144: the matter's drafts a verified judgment claim can be inserted into. */
  drafts?: readonly CopilotDraftTarget[];
  /** #1144: `insertAuthorityAction`; without it (or without drafts) there is no insert control. */
  insert?: (raw: unknown) => Promise<InsertResult>;
}

function initialThread(
  turns: readonly CopilotTurn[] | undefined,
  answer: CopilotAnswer | undefined,
): CopilotTurn[] {
  if (turns !== undefined) return [...turns];
  if (answer === undefined) return [];
  return [{ id: 'initial', question: null, requestId: '', state: 'answered', answer }];
}

export function CopilotPanel({
  workspaceId,
  workspaceSlug,
  matterId,
  ask,
  initialAnswer,
  initialTurns,
  matterContext,
  offline,
  drafts,
  insert,
}: CopilotPanelProps) {
  const t = useTranslations('research.copilot');
  const format = useFormatter();
  const browserOnline = useOnline();
  const isOffline = offline ?? !browserOnline;
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<CopilotTurn[]>(() =>
    initialThread(initialTurns, initialAnswer),
  );
  const [active, setActive] = useState<{ turn: string; n: number } | null>(null);
  // The source a chip was clicked for: stays highlighted after the pointer leaves (#1192).
  const [pinned, setPinned] = useState<{ turn: string; n: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [, start] = useTransition();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pending = turns.some((turn) => turn.state === 'pending');

  const update = (id: string, patch: Partial<CopilotTurn>) => {
    setTurns((all) => all.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  };

  function run(turn: CopilotTurn): void {
    if (turn.question === null) return;
    const text = turn.question;
    start(async () => {
      const response = await ask({
        workspaceId,
        question: text,
        requestId: turn.requestId,
        ...(matterId === undefined ? {} : { matterId }),
      });
      if (response.ok) {
        update(turn.id, { state: 'answered', answer: response.data });
        setSelected(turn.id);
      } else {
        update(turn.id, {
          state: 'failed',
          failure: {
            planLimit: response.error.code === 'CONFLICT',
            message: response.error.message,
          },
        });
      }
    });
  }

  function send(raw: string): void {
    const text = raw.trim();
    if (text === '' || pending || isOffline) return;
    const requestId = crypto.randomUUID();
    const turn: CopilotTurn = { id: requestId, question: text, requestId, state: 'pending' };
    setTurns((all) => [...all, turn]);
    setQuestion('');
    if (inputRef.current !== null) inputRef.current.style.height = '';
    run(turn);
  }

  function retry(turn: CopilotTurn): void {
    if (pending || isOffline) return;
    update(turn.id, { state: 'pending' });
    // Same request id: a retry after a failure is metered once.
    run({ ...turn, state: 'pending' });
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    send(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter is a new line; Enter that confirms an IME composition (ta, kn) does not.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(question);
  }

  const dateOf = (iso: string): string =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeZone: 'UTC' });

  const suggestions: string[] =
    matterId === undefined
      ? [
          t('suggestions.corpusBail'),
          t('suggestions.corpusAnticipatoryBail'),
          t('suggestions.corpusWrit'),
        ]
      : [
          matterContext === undefined
            ? t('suggestions.matterFacts')
            : t('suggestions.matterFactsOf', { title: matterContext.title }),
          ...(matterContext?.nextDate == null
            ? []
            : [t('suggestions.nextDate', { date: dateOf(matterContext.nextDate) })]),
          ...(matterContext?.stage == null
            ? []
            : [t('suggestions.stage', { stage: matterContext.stage })]),
          t('suggestions.matterOrders'),
          t('suggestions.matterAuthority'),
        ].slice(0, 4);

  const answered = turns.filter((turn) => turn.state === 'answered' && turn.answer !== undefined);
  const railTurn =
    answered.find((turn) => turn.id === selected && !turn.answer?.aiBlocked) ??
    answered.findLast((turn) => !turn.answer?.aiBlocked);
  const railAnswer = railTurn?.answer;
  const showRail =
    railAnswer !== undefined && (railAnswer.claims.length > 0 || railAnswer.unsupported.length > 0);
  const latest = answered.at(-1)?.answer;
  const usage = latest === undefined || latest.aiBlocked ? null : latest.usage;

  const renderInsert =
    insert === undefined || drafts === undefined || drafts.length === 0
      ? undefined
      : (claim: CopilotClaim) => {
          const ref = insertRef(claim);
          return ref === null ? null : (
            <InsertIntoDraft
              workspaceId={workspaceId}
              drafts={drafts}
              refOf={ref}
              insert={insert}
            />
          );
        };

  const activeIn = (id: string): number | null =>
    active?.turn === id ? active.n : pinned?.turn === id ? pinned.n : null;
  // Element ids of a turn's sources: the rail's and the Sheet's (both may be in the DOM).
  const idPrefixOf = (id: string, where: 'rail' | 'sheet'): string =>
    `copilot-${`${inputId}-${id}`.replace(/[^\w-]/g, '')}-${where}`;

  function showSource(turnId: string, n: number): void {
    setPinned({ turn: turnId, n });
    setSelected(turnId);
    const desktop = isDesktop();
    if (!desktop) setSheetFor(turnId);
    requestAnimationFrame(() => {
      scrollToWhenShown(sourceElementId(idPrefixOf(turnId, desktop ? 'rail' : 'sheet'), n));
    });
  }

  function rephrase(text: string): void {
    setQuestion(text);
    const el = inputRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(text.length, text.length);
  }

  const researchHref = (text: string): string =>
    `/w/${encodeURIComponent(workspaceSlug)}/research?q=${encodeURIComponent(text)}`;
  const matterHref =
    matterId === undefined ? `/w/${encodeURIComponent(workspaceSlug)}/matters` : null;
  const searching = matterId === undefined ? t('searchingCorpus') : t('searching');

  return (
    <div
      data-slot="copilot-panel"
      className={
        showRail
          ? 'grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start'
          : 'flex min-w-0 flex-col gap-6'
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        {turns.length === 0 ? (
          <EmptyState
            data-slot="copilot-empty"
            className="border-line rounded-lg border border-dashed"
            title={t('suggestions.title')}
            description={t('suggestions.description')}
            action={
              <ul className="flex w-full flex-col gap-2 sm:items-center">
                {suggestions.map((text) => (
                  <li key={text} className="w-full sm:w-auto">
                    <Button
                      type="button"
                      variant="secondary"
                      data-slot="copilot-suggestion"
                      disabled={isOffline}
                      className="h-auto min-h-11 w-full justify-start py-2 text-start whitespace-normal"
                      onClick={() => {
                        send(text);
                      }}
                    >
                      {text}
                    </Button>
                  </li>
                ))}
              </ul>
            }
          />
        ) : (
          <ol
            data-slot="copilot-thread"
            aria-label={t('thread.label')}
            aria-live="polite"
            className="flex min-w-0 flex-col gap-8"
          >
            {turns.map((turn) => {
              const answer = turn.answer;
              const hasSources =
                answer !== undefined &&
                !answer.aiBlocked &&
                (answer.claims.length > 0 || answer.unsupported.length > 0);
              return (
                <li key={turn.id} data-slot="copilot-turn" className="flex min-w-0 flex-col gap-3">
                  {turn.question === null ? null : (
                    <p
                      data-slot="copilot-question"
                      className="bg-surface-sunken text-ink ms-auto max-w-[85%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap"
                    >
                      <span className="sr-only">{t('thread.you')}: </span>
                      {turn.question}
                    </p>
                  )}
                  <div data-slot="copilot-reply" className="flex min-w-0 flex-col gap-3">
                    <span className="sr-only">{t('thread.copilot')}:</span>
                    {turn.state === 'pending' ? (
                      <SkeletonGroup data-slot="copilot-loading" labels={{ loading: searching }}>
                        <p aria-hidden="true" className="text-ink-muted text-sm">
                          {searching}
                        </p>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-2/3" />
                      </SkeletonGroup>
                    ) : null}
                    {turn.state === 'failed' && turn.failure !== undefined ? (
                      <div className="border-line flex flex-col gap-2 rounded-md border p-3">
                        {turn.failure.planLimit ? (
                          <div
                            role="alert"
                            data-slot="copilot-plan-limit"
                            className="flex flex-col gap-1 text-sm"
                          >
                            <p className="text-ink font-medium">{t('planLimit')}</p>
                            {turn.failure.message === '' ? null : (
                              <p className="text-ink-muted">{turn.failure.message}</p>
                            )}
                          </div>
                        ) : (
                          <p role="alert" data-slot="copilot-error" className="text-danger text-sm">
                            {turn.failure.message === '' ? t('error') : turn.failure.message}
                          </p>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          data-slot="copilot-retry"
                          className="min-h-11 self-start"
                          disabled={pending || isOffline}
                          onClick={() => {
                            retry(turn);
                          }}
                        >
                          {t('retry')}
                        </Button>
                      </div>
                    ) : null}
                    {answer === undefined ? null : answer.aiBlocked ? (
                      <p
                        role="status"
                        data-slot="copilot-ai-off"
                        className="text-ink-muted text-sm"
                      >
                        {t('aiOff')}
                      </p>
                    ) : (
                      <>
                        {answer.noAuthority || answer.claims.length === 0 ? (
                          <NextSteps
                            slot={answer.noAuthority ? 'copilot-no-authority' : 'copilot-weak'}
                            title={answer.noAuthority ? t('noAuthority') : t('weak.title')}
                            reason={answer.noAuthority ? t('noAuthorityReason') : t('weak.reason')}
                            question={turn.question}
                            researchHref={researchHref(turn.question ?? '')}
                            matterHref={matterHref}
                            onRephrase={
                              turn.question === null
                                ? null
                                : () => {
                                    rephrase(turn.question ?? '');
                                  }
                            }
                          />
                        ) : null}
                        <AnswerProse
                          answer={answer}
                          active={activeIn(turn.id)}
                          idPrefix={idPrefixOf(turn.id, 'rail')}
                          onActivate={(n) => {
                            setActive(n === null ? null : { turn: turn.id, n });
                            if (n !== null) setSelected(turn.id);
                          }}
                          onShowSource={(n) => {
                            showSource(turn.id, n);
                          }}
                        />
                        {hasSources ? (
                          // "View N sources" carries the scroll margin that keeps it clear of the
                          // phone's bottom nav and capture button when scrolled into view (#1194).
                          <div data-slot="copilot-sources-actions" className="flex flex-wrap gap-2">
                            <SourcesSheet
                              answer={answer}
                              active={activeIn(turn.id)}
                              open={sheetFor === turn.id}
                              onOpenChange={(open) => {
                                setSheetFor(open ? turn.id : null);
                              }}
                              renderInsert={renderInsert}
                              idPrefix={idPrefixOf(turn.id, 'sheet')}
                            />
                            {railTurn?.id === turn.id ? null : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="hidden min-h-11 lg:inline-flex"
                                onClick={() => {
                                  setSelected(turn.id);
                                }}
                              >
                                {t('sources.show')}
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {isOffline ? (
          <p
            role="status"
            data-slot="copilot-offline"
            className="border-line bg-warning-soft text-ink rounded-md border px-3 py-2 text-sm"
          >
            {t('offline')}
          </p>
        ) : null}

        <form
          onSubmit={onSubmit}
          data-slot="copilot-composer"
          // Sticky from lg so the composer stays reachable after a long answer (#1194); on phones
          // it stays in the flow above the fixed bottom nav, where a sticky box would cover the answer.
          className="border-line bg-surface-raised lg:z-sticky flex min-w-0 flex-col gap-2 rounded-lg border p-3 lg:sticky lg:bottom-4 lg:shadow-md"
        >
          {matterContext === undefined ? null : (
            <div data-slot="copilot-context" className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-ink-subtle text-xs">{t('context.label')}</span>
              <Badge tone="outline" className="max-w-full truncate">
                {matterContext.title}
              </Badge>
              {matterContext.stage === null ? null : (
                <Badge>{t('context.stage', { stage: matterContext.stage })}</Badge>
              )}
              {matterContext.nextDate === null ? null : (
                <Badge>{t('context.nextDate', { date: dateOf(matterContext.nextDate) })}</Badge>
              )}
            </div>
          )}
          <label htmlFor={inputId} className="sr-only">
            {t('questionLabel')}
          </label>
          <Textarea
            id={inputId}
            ref={inputRef}
            name="question"
            rows={2}
            maxLength={4000}
            value={question}
            placeholder={turns.length === 0 ? t('questionPlaceholder') : t('followUpPlaceholder')}
            onChange={(event) => {
              setQuestion(event.target.value);
              // Auto-grow where `field-sizing` is not supported; capped by max-h.
              const el = event.target;
              el.style.height = 'auto';
              el.style.height = `${String(el.scrollHeight)}px`;
            }}
            onKeyDown={onKeyDown}
            className="max-h-48 min-h-11 resize-none overflow-y-auto"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-ink-subtle flex min-w-0 flex-col text-xs">
              {usage === null ? null : (
                <span data-slot="copilot-usage">
                  {usage.limit === null
                    ? t('usageUnlimited', { used: usage.used })
                    : t('usage', { used: usage.used, limit: usage.limit })}
                </span>
              )}
              <span className="hidden sm:inline">{t('composerHint')}</span>
            </div>
            <Button
              type="submit"
              className="min-h-11"
              disabled={pending || isOffline || question.trim() === ''}
            >
              {pending ? t('asking') : t('submit')}
            </Button>
          </div>
        </form>
      </div>

      {showRail ? (
        <aside
          data-slot="copilot-rail"
          aria-labelledby={`${inputId}-sources`}
          className="hidden min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
        >
          <h2
            id={`${inputId}-sources`}
            className="text-ink-subtle text-xs font-medium tracking-wide uppercase"
          >
            {t('sources.title')}
          </h2>
          <SourcesList
            answer={railAnswer}
            active={railTurn === undefined ? null : activeIn(railTurn.id)}
            renderInsert={renderInsert}
            idPrefix={idPrefixOf(railTurn?.id ?? '', 'rail')}
          />
        </aside>
      ) : null}
    </div>
  );
}
