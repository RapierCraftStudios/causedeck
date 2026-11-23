'use client';
// The grounded matter copilot (#1115, ADR 0051, D-004): one question, then verified claims. Each claim
// shows its source kind, the quote and a pinpoint (page, paragraph when the text carries one) the
// server computed from the stored text, with a link to the corpus record for a judgment. A claim the
// server could not verify is listed apart under "not verified" and is not part of the answer. No hits
// is "no authority found"; a sensitive matter says AI is off; a failed call is an error, never an
// invented answer. A retry after a failure reuses the request id, so it counts once. A claim whose
// statement is its quote (the extractive demo answer) prints the sentence once, as the quote (#1132).
// #1144: with `drafts` and `insert` (matter copilot, a member who may write drafts), a verified
// judgment claim has "Insert into draft": the member picks a draft and the block to insert after; the
// claim's judgment, quote and pinpoint go to the server unaltered, which verifies them again.
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type SyntheticEvent } from 'react';

/** Whitespace-collapsed and lower-cased, as the server compares a quote with its source. */
const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

type ActionResult = { ok: true; data: CopilotAnswer } | { ok: false; error: { message: string } };

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

export interface CopilotPanelProps {
  workspaceId: string;
  /** Omitted for the workspace-level copilot. */
  matterId?: string;
  ask: (raw: unknown) => Promise<ActionResult>;
  /** Renders a stored result (stories, tests). */
  initialAnswer?: CopilotAnswer;
  /** #1144: the matter's drafts a verified judgment claim can be inserted into. */
  drafts?: readonly CopilotDraftTarget[];
  /** #1144: `insertAuthorityAction`; without it (or without drafts) there is no insert control. */
  insert?: (raw: unknown) => Promise<InsertResult>;
}

export function CopilotPanel({
  workspaceId,
  matterId,
  ask,
  initialAnswer,
  drafts,
  insert,
}: CopilotPanelProps) {
  const t = useTranslations('research.copilot');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<CopilotAnswer | null>(initialAnswer ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const requestId = useRef<string | null>(null);

  function onAsk(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = question.trim();
    if (text === '') return;
    requestId.current ??= crypto.randomUUID();
    const id = requestId.current;
    start(async () => {
      const response = await ask({
        workspaceId,
        question: text,
        requestId: id,
        ...(matterId === undefined ? {} : { matterId }),
      });
      if (response.ok) {
        requestId.current = null;
        setError(null);
        setAnswer(response.data);
      } else {
        setError(response.error.message);
      }
    });
  }

  const pinpoint = (page: number | null, paragraph: number | null): string =>
    [
      page === null ? null : t('pinpoint.page', { page }),
      paragraph === null ? null : t('pinpoint.paragraph', { paragraph }),
    ]
      .filter((part) => part !== null)
      .join(' · ');

  return (
    <div className="flex flex-col gap-6" data-slot="copilot-panel">
      <form onSubmit={onAsk} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('questionLabel')}
          <textarea
            name="question"
            rows={3}
            maxLength={4000}
            required
            value={question}
            placeholder={t('questionPlaceholder')}
            onChange={(event) => {
              setQuestion(event.target.value);
              requestId.current = null;
            }}
            className="rounded border px-2 py-1 font-normal"
          />
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || question.trim() === ''}>
            {pending ? t('asking') : t('submit')}
          </Button>
          {answer === null || answer.aiBlocked ? null : (
            <span className="text-muted-foreground text-xs" data-slot="copilot-usage">
              {answer.usage.limit === null
                ? t('usageUnlimited', { used: answer.usage.used })
                : t('usage', { used: answer.usage.used, limit: answer.usage.limit })}
            </span>
          )}
        </div>
      </form>

      {error === null ? null : (
        <p role="alert" data-slot="copilot-error" className="text-sm text-red-600">
          {error === '' ? t('error') : error}
        </p>
      )}

      {answer === null ? null : answer.aiBlocked ? (
        <p role="status" data-slot="copilot-ai-off" className="text-sm">
          {t('aiOff')}
        </p>
      ) : (
        <div className="flex flex-col gap-4" aria-live="polite">
          {answer.noAuthority ? (
            <p role="status" data-slot="copilot-no-authority" className="text-sm">
              {t('noAuthority')}
            </p>
          ) : null}
          {answer.claims.length === 0 ? null : (
            <section aria-labelledby="copilot-claims" className="flex flex-col gap-3">
              <h2 id="copilot-claims" className="text-sm font-medium">
                {t('claimsTitle')}
              </h2>
              <ul className="flex flex-col gap-3">
                {answer.claims.map((claim) => {
                  const judgment =
                    claim.judgmentId === null ? undefined : answer.judgments[claim.judgmentId];
                  const where = pinpoint(claim.pinpoint.page, claim.pinpoint.paragraph);
                  const sameText = normalise(claim.statement) === normalise(claim.quote);
                  const ref = insertRef(claim);
                  return (
                    <li
                      key={`${claim.sourceId}:${claim.quote}`}
                      data-slot="copilot-claim"
                      className="flex flex-col gap-1 rounded border p-3 text-sm"
                    >
                      {sameText ? null : <p>{claim.statement}</p>}
                      <blockquote className="text-muted-foreground border-l-2 pl-2">
                        {claim.quote}
                      </blockquote>
                      <p className="text-muted-foreground text-xs" data-slot="copilot-source">
                        {t(`kind.${claim.kind}`)}
                        {where === '' ? '' : ` · ${where}`}
                        {judgment === undefined ? null : (
                          <>
                            {' · '}
                            {judgment.sourceUrl === null ? (
                              <span>
                                {judgment.title ?? judgment.neutralCitation ?? t('record')}
                              </span>
                            ) : (
                              <a
                                href={`${judgment.sourceUrl}${claim.pinpoint.page === null ? '' : `#page=${String(claim.pinpoint.page)}`}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                {judgment.title ?? judgment.neutralCitation ?? t('record')}
                              </a>
                            )}
                          </>
                        )}
                      </p>
                      {ref === null ||
                      insert === undefined ||
                      drafts === undefined ||
                      drafts.length === 0 ? null : (
                        <InsertIntoDraft
                          workspaceId={workspaceId}
                          drafts={drafts}
                          refOf={ref}
                          insert={insert}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {answer.unsupported.length === 0 ? null : (
            <section aria-labelledby="copilot-unsupported" className="flex flex-col gap-2">
              <h2 id="copilot-unsupported" className="text-sm font-medium">
                {t('unsupportedTitle')}
              </h2>
              <ul className="flex flex-col gap-2">
                {answer.unsupported.map((claim) => (
                  <li
                    key={`${claim.sourceId}:${claim.quote}`}
                    data-slot="copilot-unsupported"
                    className="text-muted-foreground flex flex-col gap-1 rounded border border-dashed p-3 text-sm"
                  >
                    <span className="text-xs font-medium">{t('notVerified')}</span>
                    <span>{claim.statement}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
