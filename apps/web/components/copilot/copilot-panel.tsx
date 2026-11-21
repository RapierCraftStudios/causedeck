'use client';
// The grounded matter copilot (#1115, ADR 0051, D-004): one question, then verified claims. Each claim
// shows its source kind, the quote and a pinpoint (page, paragraph when the text carries one) the
// server computed from the stored text, with a link to the corpus record for a judgment. A claim the
// server could not verify is listed apart under "not verified" and is not part of the answer. No hits
// is "no authority found"; a sensitive matter says AI is off; a failed call is an error, never an
// invented answer. A retry after a failure reuses the request id, so it counts once.
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type SyntheticEvent } from 'react';

type ActionResult = { ok: true; data: CopilotAnswer } | { ok: false; error: { message: string } };

export interface CopilotPanelProps {
  workspaceId: string;
  /** Omitted for the workspace-level copilot. */
  matterId?: string;
  ask: (raw: unknown) => Promise<ActionResult>;
  /** Renders a stored result (stories, tests). */
  initialAnswer?: CopilotAnswer;
}

export function CopilotPanel({ workspaceId, matterId, ask, initialAnswer }: CopilotPanelProps) {
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
      .join(', ');

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
                  return (
                    <li
                      key={`${claim.sourceId}:${claim.quote}`}
                      data-slot="copilot-claim"
                      className="flex flex-col gap-1 rounded border p-3 text-sm"
                    >
                      <p>{claim.statement}</p>
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
