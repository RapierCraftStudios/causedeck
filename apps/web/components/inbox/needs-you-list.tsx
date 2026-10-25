'use client';
// Needs you (#48): the cards, one per decision. A `role=list` with the cards' keyboard shortcuts
// bound to the list (`j`/`k` between cards, `Enter`, `e`, `x` on the focused one), focus moving to
// the next card when one is resolved, and each card collapsing out over 200 ms (an opacity fade
// only under reduced motion). Above 100 items only the rows near the viewport are mounted. There
// is deliberately no "confirm all": a date, a new matter or a direction is decided one by one.
import type { Locale } from '@causedeck/i18n';
import { useReducedMotion } from '@causedeck/ui/hooks';
import { useProposalShortcuts } from '@causedeck/ui/patterns';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';

import type { InboxItemView } from '../../lib/inbox/view.ts';

import { EmptyNeedsYou } from './empty-states.tsx';
import { ProposalCardHost, type CardHandlers } from './proposal-card-host.tsx';

/** Above this many items the list mounts only what is near the viewport. */
export const VIRTUALISE_ABOVE = 100;

const CARD = '[data-proposal-id]';

export interface NeedsYouListProps {
  items: InboxItemView[];
  locale: Locale;
  handlers: CardHandlers;
  offline: boolean;
  readOnly: boolean;
  /** Ids collapsing out after a decision (the shell removes them once the collapse is done). */
  collapsing: ReadonlySet<string>;
  /** Bumped when an undo brings a card back, so it mounts fresh. */
  generation: Readonly<Record<string, number>>;
  /** Ids that arrived with the last refresh: they fade up. */
  fresh: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirmed: (item: InboxItemView) => void;
}

/** The fetch time of a public list, in the court's time zone. */
const formatFetchedAt = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

const idleCards = (list: HTMLElement | null): HTMLElement[] =>
  list
    ? [...list.querySelectorAll<HTMLElement>(CARD)].filter(
        (card) => card.dataset['phase'] === 'idle',
      )
    : [];

function Collapse({ collapsing, children }: { collapsing: boolean; children: ReactNode }) {
  return (
    <div
      data-state={collapsing ? 'collapsing' : 'open'}
      inert={collapsing}
      className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-200 ease-out data-[state=collapsing]:grid-rows-[0fr] data-[state=collapsing]:opacity-0 motion-reduce:transition-[opacity] motion-reduce:data-[state=collapsing]:hidden motion-reduce:data-[state=collapsing]:grid-rows-[1fr]"
    >
      <div className="min-h-0 overflow-hidden py-1.5">{children}</div>
    </div>
  );
}

export function NeedsYouList(props: NeedsYouListProps) {
  const { items, locale, handlers, offline, readOnly, collapsing, generation, onSelect } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('inbox');
  const reduced = useReducedMotion();

  const focusCard = (card: HTMLElement | undefined) => {
    card?.focus();
  };

  const onMove = (from: Element | null, step: 1 | -1) => {
    const cards = idleCards(listRef.current);
    const index = cards.findIndex((card) => card === from);
    const next = index === -1 ? 0 : Math.min(Math.max(index + step, 0), cards.length - 1);
    focusCard(cards[next]);
  };
  const onKeyDown = useProposalShortcuts({ onMove });

  /** When the card that holds focus is resolved, focus goes to the next one (else the previous). */
  const moveFocusFrom = (id: string) => {
    const list = listRef.current;
    const focused = document.activeElement;
    const own = list?.querySelector<HTMLElement>(
      `[data-item-id="${CSS.escape(id)}"], ${CARD}[data-proposal-id="${CSS.escape(id)}"]`,
    );
    if (!list || !own || !(own === focused || own.contains(focused))) return;
    const cards = idleCards(list).filter((card) => !own.contains(card) && card !== own);
    const all = [...list.querySelectorAll<HTMLElement>(CARD)];
    const here = all.findIndex((card) => own.contains(card) || card === own);
    const after = cards.find((card) => all.indexOf(card) > here);
    const before = [...cards].reverse().find((card) => all.indexOf(card) < here);
    const target = after ?? before;
    if (target) focusCard(target);
    else list.focus();
  };

  const seen = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    for (const id of collapsing) if (!seen.current.has(id)) moveFocusFrom(id);
    seen.current = new Set(collapsing);
  });

  const virtual = items.length > VIRTUALISE_ABOVE;
  const virtualizer = useWindowVirtualizer({
    count: virtual ? items.length : 0,
    estimateSize: () => 190,
    overscan: 6,
  });

  if (items.length === 0) return <EmptyNeedsYou />;

  const row = (item: InboxItemView) => (
    <motion.div
      key={`${item.id}:${String(generation[item.id] ?? 0)}`}
      initial={props.fresh.has(item.id) && !reduced ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      role="listitem"
      onFocusCapture={() => {
        onSelect(item.id);
      }}
      onClickCapture={() => {
        onSelect(item.id);
      }}
      data-selected={props.selectedId === item.id ? '' : undefined}
      className="data-[selected]:[&_[data-slot=proposal-card]]:border-accent"
    >
      <Collapse collapsing={collapsing.has(item.id)}>
        <ProposalCardHost
          item={item}
          locale={locale}
          handlers={handlers}
          offline={offline}
          readOnly={readOnly}
          onConfirmed={props.onConfirmed}
          onCollapse={(resolved) => {
            moveFocusFrom(resolved.id);
          }}
        />
        {item.sourceFetchedAt == null ? null : (
          <p data-slot="source-chip" className="text-ink-muted px-1 pt-1 text-xs">
            {t('sourceChip.khcList', { time: formatFetchedAt(item.sourceFetchedAt, locale) })}
          </p>
        )}
      </Collapse>
    </motion.div>
  );

  return (
    <div
      ref={listRef}
      role="list"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-slot="needs-you-list"
      className="outline-none"
    >
      {virtual ? (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            if (item === undefined) return null;
            return (
              <div
                key={item.id}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
              >
                {row(item)}
              </div>
            );
          })}
        </div>
      ) : (
        items.map(row)
      )}
    </div>
  );
}
