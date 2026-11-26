'use client';
// The copilot's answer (#1168): the written answer with its `[n]` markers as numbered citation chips,
// and the sources those chips point at. A chip exists only for a marker that names a verified claim
// (n is 1-based into `claims`); any other marker is dropped, so the prose never cites something the
// server did not verify (D-004). Hovering or focusing a chip highlights its source; a chip is a link
// to its source (#1192): clicking it scrolls to the source and keeps it highlighted (the panel opens
// the Sheet first below `lg`). The answer leads with its verified bottom line, then the written answer
// rendered as light markdown (answer-markdown.tsx: React elements only, never raw HTML). The sources are a
// rail beside the thread from `lg` up and a Sheet below it; each shows the kind, the verified quote,
// the page/paragraph pinpoint and a link that opens the judgment in the in-app reader at that page and
// paragraph (#1191; never the stored archive URL). Claims the server could not verify sit in a
// collapsed "Not verified" group with the reason, never among the sources.
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { courtLabel } from '@causedeck/intelligence/citation-display';
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
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';

import { judgmentHref, slugOf } from '../../lib/judgment-href.ts';

import {
  AnswerMarkdown,
  InlineMarkdown,
  splitCitations,
  type AnswerPart,
} from './answer-markdown.tsx';

export type { AnswerPart } from './answer-markdown.tsx';

export type CopilotClaim = CopilotAnswer['claims'][number];

/** The element id of source `n` in the list rendered with `idPrefix`. */
export const sourceElementId = (idPrefix: string, n: number): string =>
  `${idPrefix}-source-${String(n)}`;

/**
 * Splits the answer into text and citations (`[n]` and `[n, m]`). A number with no verified claim is
 * dropped; a marker left empty is removed with the space before it; it never becomes a chip.
 */
export function parseAnswer(answer: string, claimCount: number): AnswerPart[] {
  return splitCitations(answer, claimCount);
}

/** Whitespace-collapsed and lower-cased, as the server compares a quote with its source. */
const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

interface CiteHandlers {
  /** The claim highlighted in this answer, or null. */
  active: number | null;
  onActivate: (n: number | null) => void;
  /** Scrolls to source `n` and keeps it highlighted. */
  onShowSource: (n: number) => void;
  /** The id prefix of this answer's sources (`sourceElementId`). */
  idPrefix: string;
}

function CiteChip({ n, active, onActivate, onShowSource, idPrefix }: CiteHandlers & { n: number }) {
  const t = useTranslations('research.copilot');
  return (
    <a
      href={`#${sourceElementId(idPrefix, n)}`}
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
      onClick={(event) => {
        event.preventDefault();
        onActivate(n);
        onShowSource(n);
      }}
      className="border-line bg-surface-sunken text-ink-muted hover:border-accent hover:text-accent focus-visible:outline-ring data-[active=true]:border-accent data-[active=true]:bg-accent-soft data-[active=true]:text-accent mx-0.5 inline-flex min-w-6 items-center justify-center rounded-sm border px-1 align-baseline font-sans text-xs font-medium tabular-nums underline decoration-1 underline-offset-2 outline-offset-2 focus-visible:outline-2"
    >
      {n}
    </a>
  );
}

/**
 * The verified bottom line first, then the written answer with its chips; an older answer without
 * markers prints each claim with its chip.
 */
export function AnswerProse({ answer, ...handlers }: CiteHandlers & { answer: CopilotAnswer }) {
  const t = useTranslations('research.copilot');
  const claimCount = answer.claims.length;
  if (claimCount === 0) return null;
  const cite = (n: number, key: string) => <CiteChip key={key} n={n} {...handlers} />;
  const bottomLine = answer.bottomLine.trim();
  const written = answer.answer.trim();
  return (
    <div data-slot="copilot-answer" className="text-ink flex flex-col gap-3 text-base leading-7">
      {bottomLine === '' ? null : (
        <p data-slot="copilot-bottom-line" className="text-ink text-base leading-7 font-semibold">
          <span className="sr-only">{t('bottomLine')}: </span>
          <InlineMarkdown text={bottomLine} claimCount={claimCount} renderCite={cite} />
        </p>
      )}
      {written === '' ? (
        <p>
          {answer.claims.map((claim, i) => (
            <Fragment key={i}>
              {i === 0 ? '' : ' '}
              {claim.statement}
              {cite(i + 1, `c${String(i)}`)}
            </Fragment>
          ))}
        </p>
      ) : (
        <AnswerMarkdown text={written} claimCount={claimCount} renderCite={cite} />
      )}
    </div>
  );
}

function SourceItem({
  claim,
  n,
  answer,
  active,
  insertControl,
  idPrefix,
}: {
  claim: CopilotClaim;
  n: number;
  answer: CopilotAnswer;
  active: boolean;
  insertControl: ReactNode;
  idPrefix: string;
}) {
  const t = useTranslations('research.copilot');
  const slug = slugOf(useParams());
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
  // The reference (neutral, else SCR citation, #1189) and the court name follow a titled record.
  const detail =
    judgment === undefined
      ? ''
      : [judgment.title === null ? null : judgment.neutralCitation, courtLabel(judgment.court)]
          .filter((part) => part !== null && part !== '')
          .join(' · ');
  return (
    <li
      id={sourceElementId(idPrefix, n)}
      data-slot="copilot-claim"
      data-n={n}
      data-active={active ? 'true' : undefined}
      className="border-line bg-surface-raised data-[active=true]:border-accent data-[active=true]:bg-accent-soft flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-md border p-3 text-sm transition-colors motion-reduce:transition-none"
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
            {slug === null || claim.judgmentId === null ? (
              <span>{name}</span>
            ) : (
              <a
                data-slot="copilot-source-link"
                href={judgmentHref(slug, claim.judgmentId, {
                  page: claim.pinpoint.page,
                  para: claim.pinpoint.paragraph,
                })}
                className="text-accent underline underline-offset-2"
              >
                {name}
              </a>
            )}
            {detail === '' ? null : ` · ${detail}`}
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
  idPrefix,
}: {
  answer: CopilotAnswer;
  active: number | null;
  renderInsert?: ((claim: CopilotClaim) => ReactNode) | undefined;
  idPrefix: string;
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
              idPrefix={idPrefix}
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
  idPrefix,
}: {
  answer: CopilotAnswer;
  active: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderInsert?: ((claim: CopilotClaim) => ReactNode) | undefined;
  idPrefix: string;
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
        <SourcesList
          answer={answer}
          active={active}
          renderInsert={renderInsert}
          idPrefix={idPrefix}
        />
      </SheetContent>
    </Sheet>
  );
}
