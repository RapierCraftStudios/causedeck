'use client';
// The copilot's answer (#1168): the written answer with its `[n]` markers as numbered citation chips,
// and the sources those chips point at. A chip exists only for a marker that names a verified claim
// (n is 1-based into `claims`); any other marker is dropped, so the prose never cites something the
// server did not verify (D-004). Hovering or focusing a chip highlights its source. The sources are a
// rail beside the thread from `lg` up and a Sheet below it; each shows the kind, the verified quote,
// the page/paragraph pinpoint and the corpus record link. Claims the server could not verify sit in a
// collapsed "Not verified" group with the reason, never among the sources.
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@causedeck/ui/collapsible';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@causedeck/ui/sheet';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';

export type CopilotClaim = CopilotAnswer['claims'][number];

/** A run of answer text, or a citation of verified claim `n` (1-based). */
export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; n: number };

const MARKER = /\s*\[(\d{1,3})\]/g;

/**
 * Splits the answer into text and citations. A marker whose index has no verified claim is removed
 * with the space before it; it never becomes a chip.
 */
export function parseAnswer(answer: string, claimCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (text === '') return;
    const prev = parts.at(-1);
    if (prev?.kind === 'text') prev.text += text;
    else parts.push({ kind: 'text', text });
  };
  for (const match of answer.matchAll(MARKER)) {
    pushText(answer.slice(last, match.index));
    last = match.index + match[0].length;
    const n = Number(match[1]);
    if (n >= 1 && n <= claimCount) parts.push({ kind: 'cite', n });
  }
  pushText(answer.slice(last));
  return parts;
}

/** Whitespace-collapsed and lower-cased, as the server compares a quote with its source. */
const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

interface CiteHandlers {
  /** The claim highlighted in this answer, or null. */
  active: number | null;
  onActivate: (n: number | null) => void;
}

function CiteChip({
  n,
  active,
  onActivate,
  onOpen,
}: CiteHandlers & { n: number; onOpen: () => void }) {
  const t = useTranslations('research.copilot');
  return (
    <button
      type="button"
      data-slot="copilot-cite"
      data-active={active === n ? 'true' : undefined}
      aria-label={t('cite', { n })}
      onMouseEnter={() => {
        onActivate(n);
      }}
      onMouseLeave={() => {
        onActivate(null);
      }}
      onFocus={() => {
        onActivate(n);
      }}
      onBlur={() => {
        onActivate(null);
      }}
      onClick={() => {
        onActivate(n);
        onOpen();
      }}
      className="border-line bg-surface-sunken text-ink-muted hover:border-accent hover:text-accent focus-visible:outline-ring data-[active=true]:border-accent data-[active=true]:bg-accent-soft data-[active=true]:text-accent mx-0.5 inline-flex min-w-6 items-center justify-center rounded-sm border px-1 align-baseline font-sans text-xs font-medium tabular-nums outline-offset-2 focus-visible:outline-2"
    >
      {n}
    </button>
  );
}

/** The written answer with its chips; an older answer without markers prints each claim with its chip. */
export function AnswerProse({
  answer,
  active,
  onActivate,
  onOpenSources,
}: CiteHandlers & { answer: CopilotAnswer; onOpenSources: () => void }) {
  const parts: AnswerPart[] =
    answer.answer.trim() === ''
      ? answer.claims.flatMap((claim, i): AnswerPart[] => [
          { kind: 'text', text: `${i === 0 ? '' : ' '}${claim.statement}` },
          { kind: 'cite', n: i + 1 },
        ])
      : parseAnswer(answer.answer, answer.claims.length);
  if (parts.length === 0) return null;
  return (
    <p data-slot="copilot-answer" className="text-ink text-base leading-7">
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          <Fragment key={i}>{part.text}</Fragment>
        ) : (
          <CiteChip
            key={i}
            n={part.n}
            active={active}
            onActivate={onActivate}
            onOpen={onOpenSources}
          />
        ),
      )}
    </p>
  );
}

function SourceItem({
  claim,
  n,
  answer,
  active,
  insertControl,
}: {
  claim: CopilotClaim;
  n: number;
  answer: CopilotAnswer;
  active: boolean;
  insertControl: ReactNode;
}) {
  const t = useTranslations('research.copilot');
  const judgment = claim.judgmentId === null ? undefined : answer.judgments[claim.judgmentId];
  const where = [
    claim.pinpoint.page === null ? null : t('pinpoint.page', { page: claim.pinpoint.page }),
    claim.pinpoint.paragraph === null
      ? null
      : t('pinpoint.paragraph', { paragraph: claim.pinpoint.paragraph }),
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const sameText = normalise(claim.statement) === normalise(claim.quote);
  const name =
    judgment === undefined ? null : (judgment.title ?? judgment.neutralCitation ?? t('record'));
  return (
    <li
      data-slot="copilot-claim"
      data-n={n}
      data-active={active ? 'true' : undefined}
      className="border-line bg-surface-raised data-[active=true]:border-accent data-[active=true]:bg-accent-soft flex min-w-0 flex-col gap-2 rounded-md border p-3 text-sm transition-colors motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="border-line-strong text-ink inline-flex min-w-6 justify-center rounded-sm border px-1 text-xs font-medium tabular-nums"
        >
          {n}
        </span>
        <Badge tone={claim.kind === 'seg' ? 'info' : 'neutral'}>{t(`kind.${claim.kind}`)}</Badge>
        <span className="sr-only">{t('cite', { n })}</span>
      </div>
      {sameText ? null : <p className="text-ink break-words">{claim.statement}</p>}
      <blockquote className="border-line-strong text-ink-muted border-l-2 pl-2 break-words">
        {claim.quote}
      </blockquote>
      <p className="text-ink-muted text-xs break-words" data-slot="copilot-source">
        {t(`kind.${claim.kind}`)}
        {where === '' ? '' : ` · ${where}`}
        {name === null || judgment === undefined ? null : (
          <>
            {' · '}
            {judgment.sourceUrl === null ? (
              <span>{name}</span>
            ) : (
              <a
                href={`${judgment.sourceUrl}${claim.pinpoint.page === null ? '' : `#page=${String(claim.pinpoint.page)}`}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                {name}
              </a>
            )}
          </>
        )}
      </p>
      {insertControl}
    </li>
  );
}

/** The verified sources of one answer, then the collapsed "Not verified" group. */
export function SourcesList({
  answer,
  active,
  renderInsert,
}: {
  answer: CopilotAnswer;
  active: number | null;
  renderInsert?: ((claim: CopilotClaim) => ReactNode) | undefined;
}) {
  const t = useTranslations('research.copilot');
  return (
    <div data-slot="copilot-sources" className="flex min-w-0 flex-col gap-3">
      {answer.claims.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('sources.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label={t('sources.title')}>
          {answer.claims.map((claim, i) => (
            <SourceItem
              key={`${claim.sourceId}:${claim.quote}`}
              claim={claim}
              n={i + 1}
              answer={answer}
              active={active === i + 1}
              insertControl={renderInsert?.(claim) ?? null}
            />
          ))}
        </ol>
      )}
      {answer.unsupported.length === 0 ? null : (
        <Collapsible data-slot="copilot-not-verified" className="flex flex-col gap-2">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 justify-start">
              {t('sources.notVerified', { count: answer.unsupported.length })}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col gap-2">
              {answer.unsupported.map((claim) => (
                <li
                  key={`${claim.sourceId}:${claim.quote}`}
                  data-slot="copilot-unsupported"
                  className="border-line text-ink-muted flex flex-col gap-1 rounded-md border border-dashed p-3 text-sm"
                >
                  <span className="text-xs font-medium">{t('unsupportedTitle')}</span>
                  <span className="break-words">{claim.statement}</span>
                  <span className="text-xs">{t(`reason.${claim.reason}`)}</span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/** Below `lg`: the sources of one answer open in a Sheet. */
export function SourcesSheet({
  answer,
  active,
  open,
  onOpenChange,
  renderInsert,
}: {
  answer: CopilotAnswer;
  active: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderInsert?: ((claim: CopilotClaim) => ReactNode) | undefined;
}) {
  const t = useTranslations('research.copilot');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-slot="copilot-sources-open"
          className="min-h-11 scroll-mb-[calc(var(--space-6)+72px+env(safe-area-inset-bottom))] self-start lg:hidden"
        >
          {t('sources.open', { count: answer.claims.length })}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        labels={{ close: t('sources.close') }}
        data-slot="copilot-sources-sheet"
        className="max-h-[85dvh] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>{t('sources.title')}</SheetTitle>
          <SheetDescription>{t('sources.description')}</SheetDescription>
        </SheetHeader>
        <SourcesList answer={answer} active={active} renderInsert={renderInsert} />
      </SheetContent>
    </Sheet>
  );
}
