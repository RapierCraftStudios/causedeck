import { useCallback, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/button';
import { Skeleton } from '../../components/skeleton';
import { cn } from '../../lib/cn';
import type { Anchor, Proposal } from '../types';
import { ProposalCard, ProposalCardSkeleton, type ProposalCardLabels } from './proposal-card';
import { CARD_SELECTOR, runProposalAction, useProposalShortcuts } from './use-proposal-shortcuts';

export interface ProposalCardGroupLabels {
  /** Header: how many proposals still need the lawyer. */
  needYou: (count: number) => string;
  confirmAllSafe: string;
  /** Live region text after a confirmation succeeds. */
  confirmed: string;
  empty: string;
}

export const DEFAULT_PROPOSAL_GROUP_LABELS: ProposalCardGroupLabels = {
  needYou: (count) => `${String(count)} need you`,
  confirmAllSafe: 'Confirm all safe',
  confirmed: 'Proposal confirmed',
  empty: 'Nothing needs you right now.',
};

export interface ProposalCardGroupProps<T> extends Omit<
  ComponentProps<'section'>,
  'children' | 'title'
> {
  proposals: Proposal<T>[];
  /** Provenance excerpts by `Anchor.id` (`proposal.source.anchorId`). */
  anchors?: Record<string, Anchor> | undefined;
  renderValue?: ((value: T) => ReactNode) | undefined;
  onConfirm?: ((proposal: Proposal<T>) => Promise<void> | void) | undefined;
  onEdit?: ((proposal: Proposal<T>) => void) | undefined;
  onDismiss?: ((proposal: Proposal<T>) => void) | undefined;
  /** A confirmation succeeded and its card has collapsed out of the list. */
  onConfirmed?: ((proposal: Proposal<T>) => void) | undefined;
  disabled?: boolean | undefined;
  offline?: boolean | undefined;
  viewOnly?: boolean | undefined;
  loading?: boolean | undefined;
  /** Keyboard hints on desktop. */
  showShortcuts?: boolean | undefined;
  labels?: Partial<ProposalCardGroupLabels> | undefined;
  cardLabels?: Partial<ProposalCardLabels> | undefined;
}

const cardsIn = (list: HTMLElement | null): HTMLElement[] =>
  list
    ? [...list.querySelectorAll<HTMLElement>(CARD_SELECTOR)].filter(
        (card) => card.dataset['phase'] === 'idle',
      )
    : [];

/**
 * Proposals waiting for the lawyer: a `role=list` with a roving tabindex. While focus is inside,
 * `J`/`K` move between cards and `Enter`, `E`, `Backspace`/`X` act on the focused one.
 * `Confirm all safe` appears only for proposals the caller marked `safe`; nothing is automatic.
 */
export function ProposalCardGroup<T>({
  proposals,
  anchors,
  renderValue,
  onConfirm,
  onEdit,
  onDismiss,
  onConfirmed,
  disabled = false,
  offline = false,
  viewOnly = false,
  loading = false,
  showShortcuts = true,
  labels,
  cardLabels,
  className,
  ...props
}: ProposalCardGroupProps<T>) {
  const text = { ...DEFAULT_PROPOSAL_GROUP_LABELS, ...labels };
  const headingId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });

  const visible = proposals.filter((proposal) => !done.has(proposal.id));
  const open = visible.filter((proposal) => !pending.has(proposal.id));
  const safe = open.filter((proposal) => proposal.safe === true);
  const rovingId = open.some((proposal) => proposal.id === activeId) ? activeId : open[0]?.id;

  const focusCard = (card: HTMLElement | undefined) => {
    if (!card) return;
    setActiveId(card.dataset['proposalId']);
    card.focus();
  };

  const onMove = useCallback((from: Element | null, step: 1 | -1) => {
    const cards = cardsIn(listRef.current);
    const index = cards.findIndex((card) => card === from);
    const next = index === -1 ? 0 : Math.min(Math.max(index + step, 0), cards.length - 1);
    const card = cards[next];
    if (!card) return;
    setActiveId(card.dataset['proposalId']);
    card.focus();
  }, []);
  const onKeyDown = useProposalShortcuts({ onMove });

  const update = (set: typeof setDone, id: string, add: boolean) => {
    set((current) => {
      const next = new Set(current);
      if (add) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  /** A card started collapsing: if it had focus, move on to its neighbour. */
  const handleCollapse = (proposal: Proposal<T>) => {
    update(setPending, proposal.id, true);
    const list = listRef.current;
    const all = list ? [...list.querySelectorAll<HTMLElement>(CARD_SELECTOR)] : [];
    const card = all.find((element) => element.dataset['proposalId'] === proposal.id);
    const focused = document.activeElement;
    if (!card || !(card === focused || card.contains(focused))) return;
    const position = all.indexOf(card);
    const after = all.slice(position + 1).find((element) => element.dataset['phase'] === 'idle');
    const before = all
      .slice(0, position)
      .reverse()
      .find((element) => element.dataset['phase'] === 'idle');
    if (after ?? before) focusCard(after ?? before);
    else list?.focus();
  };

  const handleConfirmed = (proposal: Proposal<T>) => {
    update(setDone, proposal.id, true);
    update(setPending, proposal.id, false);
    setAnnouncement((current) => ({ text: text.confirmed, count: current.count + 1 }));
    onConfirmed?.(proposal);
  };

  const handleFailed = (proposal: Proposal<T>) => {
    update(setPending, proposal.id, false);
    setActiveId(proposal.id);
  };

  const confirmAllSafe = () => {
    const ids = new Set(safe.map((proposal) => proposal.id));
    for (const card of cardsIn(listRef.current)) {
      if (ids.has(card.dataset['proposalId'] ?? '')) runProposalAction(card, 'confirm');
    }
  };

  const live = (
    <div role="status" aria-live="polite" data-slot="proposal-live" className="sr-only">
      {announcement.text ? <span key={announcement.count}>{announcement.text}</span> : null}
    </div>
  );

  if (loading) {
    return (
      <section
        aria-busy="true"
        data-slot="proposal-card-group"
        className={cn('flex flex-col gap-3', className)}
        {...props}
      >
        <Skeleton className="h-7 w-32" />
        <ProposalCardSkeleton />
        <ProposalCardSkeleton />
        {live}
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-slot="proposal-card-group"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    >
      <header className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-ink font-sans text-base font-medium">
          {visible.length === 0 ? text.empty : text.needYou(open.length)}
        </h2>
        {safe.length > 0 && !viewOnly ? (
          <Button
            data-slot="proposal-confirm-all"
            variant="secondary"
            size="sm"
            disabled={disabled || offline}
            className="pointer-coarse:min-h-11"
            onClick={confirmAllSafe}
          >
            {text.confirmAllSafe}
          </Button>
        ) : null}
      </header>
      <div
        ref={listRef}
        role="list"
        aria-labelledby={headingId}
        // The list takes focus only when its last card has collapsed.
        tabIndex={-1}
        data-slot="proposal-list"
        className="flex flex-col gap-3 outline-none"
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const card = (event.target as Element).closest<HTMLElement>(CARD_SELECTOR);
          if (card?.dataset['phase'] === 'idle') setActiveId(card.dataset['proposalId']);
        }}
      >
        {visible.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            listItem
            proposal={proposal}
            anchor={
              proposal.source.anchorId === undefined
                ? undefined
                : anchors?.[proposal.source.anchorId]
            }
            renderValue={renderValue}
            cardTabIndex={proposal.id === rovingId ? 0 : -1}
            onConfirm={onConfirm}
            onEdit={onEdit}
            onDismiss={onDismiss}
            onCollapse={handleCollapse}
            onConfirmed={handleConfirmed}
            onConfirmFailed={handleFailed}
            disabled={disabled}
            offline={offline}
            viewOnly={viewOnly}
            showShortcuts={showShortcuts}
            labels={cardLabels}
          />
        ))}
      </div>
      {live}
    </section>
  );
}
