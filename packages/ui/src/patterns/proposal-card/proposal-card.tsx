import { ArrowRight } from 'lucide-react';
import { motion, type Transition } from 'motion/react';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/button';
import { Kbd } from '../../components/kbd';
import { Skeleton } from '../../components/skeleton';
import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { cn } from '../../lib/cn';
import { listSpring } from '../../lib/motion';
import { LevelBadge } from '../automation-level/level-badge';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import { confidencePercent } from '../provenance-chip/provenance-popover';
import type { Anchor, Proposal } from '../types';
import { PROPOSAL_SHORTCUTS, type ProposalAction } from './use-proposal-shortcuts';

/** The confirm check draws over `--dur-base`. */
export const CONFIRM_CHECK_MS = 200;

/** `--ease-standard` (tokens/motion.css) as cubic-bezier points for `motion`. */
export const EASE_STANDARD: [number, number, number, number] = [0.2, 0, 0, 1];

/** The check stroke: 200 ms `--ease-standard`. */
export const CHECK_TRANSITION: Transition = {
  duration: CONFIRM_CHECK_MS / 1000,
  ease: EASE_STANDARD,
};

/** The card collapses on the token list spring; its content fades over 200 ms `--ease-standard`. */
export const COLLAPSE_TRANSITION: Transition = {
  ...listSpring,
  opacity: { duration: CONFIRM_CHECK_MS / 1000, ease: EASE_STANDARD },
};

/** Reduced motion: the check and the collapse are instant. */
export const INSTANT_TRANSITION: Transition = { duration: 0 };

export interface ProposalCardLabels {
  confirm: string;
  edit: string;
  dismiss: string;
  confirmed: string;
  /** Screen-reader prefixes for the diff values. */
  before: string;
  after: string;
  confidence: (percent: number) => string;
  /** Inline error when confirming fails; the card is restored. */
  confirmFailed: string;
  offline: string;
  viewOnly: string;
}

export const DEFAULT_PROPOSAL_CARD_LABELS: ProposalCardLabels = {
  confirm: 'Confirm',
  edit: 'Edit',
  dismiss: 'Dismiss',
  confirmed: 'Confirmed',
  before: 'Currently',
  after: 'Proposed',
  confidence: (percent) => `${String(percent)}% confidence`,
  confirmFailed: 'Could not confirm this change. Nothing was saved; try again.',
  offline: 'You are offline. Reconnect to confirm, edit or dismiss.',
  viewOnly: 'View only. You can read this proposal but not act on it.',
};

type Phase = 'idle' | 'checking' | 'collapsed';

export interface ProposalCardProps<T> extends Omit<
  ComponentProps<'div'>,
  'children' | 'title' | 'ref' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'
> {
  proposal: Proposal<T>;
  /** The excerpt `proposal.source.anchorId` points at, for the provenance popover. */
  anchor?: Anchor | undefined;
  /** How a value is shown in the diff. Defaults to `String(value)`. */
  renderValue?: ((value: T) => ReactNode) | undefined;
  /** Persist the confirmation. The card resolves optimistically; a rejection restores it. */
  onConfirm?: ((proposal: Proposal<T>) => Promise<void> | void) | undefined;
  onEdit?: ((proposal: Proposal<T>) => void) | undefined;
  onDismiss?: ((proposal: Proposal<T>) => void) | undefined;
  /** The check has drawn and the card starts collapsing (focus should move on). */
  onCollapse?: ((proposal: Proposal<T>) => void) | undefined;
  /** The confirmation succeeded and the card has collapsed: the caller can drop it. */
  onConfirmed?: ((proposal: Proposal<T>) => void) | undefined;
  /** The confirmation failed and the card was restored. */
  onConfirmFailed?: ((proposal: Proposal<T>) => void) | undefined;
  /** Every action disabled (e.g. while a parent saves). */
  disabled?: boolean | undefined;
  /** Read-only: actions disabled with the reason. */
  offline?: boolean | undefined;
  /** Permission denied: actions hidden and a view-only note shown. */
  viewOnly?: boolean | undefined;
  /** An error from the caller, shown inline (e.g. the proposal is stale). */
  error?: string | undefined;
  /** Keyboard hints on desktop. */
  showShortcuts?: boolean | undefined;
  /** Rendered inside a `ProposalCardGroup` list. */
  listItem?: boolean | undefined;
  /** Roving tabindex of the focusable card. */
  cardTabIndex?: number | undefined;
  labels?: Partial<ProposalCardLabels> | undefined;
}

/** The confirm check, drawn as a stroke. */
function ConfirmCheck({ reduced }: { reduced: boolean }) {
  return (
    <svg
      aria-hidden="true"
      data-slot="proposal-check"
      viewBox="0 0 24 24"
      className="text-success size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        initial={{ pathLength: reduced ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={reduced ? INSTANT_TRANSITION : CHECK_TRANSITION}
      />
    </svg>
  );
}

interface ActionButtonProps {
  name: ProposalAction;
  disabled: boolean;
  title: string | undefined;
  showShortcut: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** Confirm (primary, full width when stacked), Edit and Dismiss (ghost), each with its shortcut. */
function ActionButton({
  name,
  disabled,
  title,
  showShortcut,
  onClick,
  children,
}: ActionButtonProps) {
  return (
    <Button
      data-proposal-action={name}
      variant={name === 'confirm' ? 'primary' : 'ghost'}
      aria-keyshortcuts={PROPOSAL_SHORTCUTS[name].aria}
      disabled={disabled}
      title={title}
      className={cn('pointer-coarse:min-h-11', name === 'confirm' && 'w-full md:w-auto')}
      onClick={onClick}
    >
      {children}
      {showShortcut ? (
        <Kbd
          aria-hidden="true"
          hotkey={PROPOSAL_SHORTCUTS[name].hint}
          className="hidden md:pointer-fine:inline-flex"
        />
      ) : null}
    </Button>
  );
}

/**
 * An L2 proposal: what Lawyer OS wants to change, where it read it, and Confirm, Edit or Dismiss.
 * Confirm is optimistic: the check draws, the card collapses, and a failure restores the card with
 * an inline error and focus on the card. Nothing here sends, files or pays for anything.
 */
export function ProposalCard<T>({
  proposal,
  anchor,
  renderValue = (value: T) => String(value),
  onConfirm,
  onEdit,
  onDismiss,
  onCollapse,
  onConfirmed,
  onConfirmFailed,
  disabled = false,
  offline = false,
  viewOnly = false,
  error,
  showShortcuts = true,
  listItem = false,
  cardTabIndex = 0,
  labels,
  className,
  ...props
}: ProposalCardProps<T>) {
  const text = { ...DEFAULT_PROPOSAL_CARD_LABELS, ...labels };
  const reduced = useReducedMotion();
  const titleId = useId();
  const errorId = useId();
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [resolved, setResolved] = useState(false);
  const [failures, setFailures] = useState(0);
  const attempt = useRef(0);
  const callbacks = useRef({ onCollapse, onConfirmed, proposal });

  useEffect(() => {
    callbacks.current = { onCollapse, onConfirmed, proposal };
  });

  // The check draws, then the card collapses.
  useEffect(() => {
    if (phase !== 'checking') return undefined;
    const timer = setTimeout(
      () => {
        setPhase('collapsed');
        callbacks.current.onCollapse?.(callbacks.current.proposal);
      },
      reduced ? 0 : CONFIRM_CHECK_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [phase, reduced]);

  // Report success only once the card has collapsed, so the check is never cut short.
  useEffect(() => {
    if (phase === 'collapsed' && resolved) {
      callbacks.current.onConfirmed?.(callbacks.current.proposal);
    }
  }, [phase, resolved]);

  // A failed confirm restores the card and returns focus to it.
  useEffect(() => {
    if (failures > 0) innerRef.current?.focus();
  }, [failures]);

  const confirm = () => {
    if (phase !== 'idle') return;
    const current = ++attempt.current;
    // Keep focus on the card while its buttons give way to the check (Confirm all leaves it be).
    if (innerRef.current?.contains(document.activeElement)) innerRef.current.focus();
    setResolved(false);
    setPhase('checking');
    Promise.resolve()
      .then(() => onConfirm?.(proposal))
      .then(
        () => {
          if (current === attempt.current) setResolved(true);
        },
        () => {
          if (current !== attempt.current) return;
          setPhase('idle');
          setFailures((count) => count + 1);
          onConfirmFailed?.(proposal);
        },
      );
  };

  const collapsed = phase === 'collapsed';
  const busy = phase !== 'idle';
  const inlineError = failures > 0 && phase === 'idle' ? text.confirmFailed : error;
  const confidence =
    proposal.source.confidence === undefined
      ? undefined
      : confidencePercent(proposal.source.confidence);
  const actionsDisabled = disabled || offline;

  const shared = {
    disabled: actionsDisabled,
    title: offline ? text.offline : undefined,
    showShortcut: showShortcuts,
  };

  return (
    <motion.div
      data-slot="proposal-card-item"
      role={listItem ? 'listitem' : undefined}
      aria-hidden={collapsed || undefined}
      inert={collapsed}
      layout={reduced ? false : 'position'}
      initial={false}
      animate={collapsed ? { height: 0, opacity: 0 } : { height: 'auto', opacity: 1 }}
      transition={reduced ? INSTANT_TRANSITION : COLLAPSE_TRANSITION}
      // Clip only while collapsing, so the focus ring is never cut off.
      className={cn(collapsed && 'overflow-hidden')}
    >
      <div
        ref={innerRef}
        role="group"
        tabIndex={cardTabIndex}
        aria-labelledby={titleId}
        aria-describedby={inlineError ? errorId : undefined}
        data-slot="proposal-card"
        data-proposal-id={proposal.id}
        data-safe={proposal.safe ? '' : undefined}
        data-phase={phase}
        data-source-state={proposal.source.state}
        className={cn(
          'bg-surface-raised border-line relative rounded-xl border p-4',
          'grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4',
          'focus-visible:outline-ring outline-offset-2 focus-visible:outline-2',
          // L2 amber edge while proposed; a filled amber dot in forced colours.
          proposal.source.state === 'proposed' &&
            'border-l-level-l2 border-l-3 forced-colors:border-l',
          className,
        )}
        {...props}
      >
        {proposal.source.state === 'proposed' ? (
          <span
            aria-hidden="true"
            data-slot="proposal-forced-colors-dot"
            className="absolute top-4 -left-1 hidden size-2 rounded-full forced-colors:block forced-colors:bg-[Highlight]"
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-3">
          <h3 id={titleId} className="text-ink font-serif text-lg leading-snug">
            {proposal.title}
          </h3>
          <p
            data-slot="proposal-diff"
            className="bg-surface-sunken flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg p-3 text-sm"
          >
            {proposal.before === undefined ? null : (
              <>
                <del data-slot="proposal-before" className="text-ink-subtle line-through">
                  <span className="sr-only">{text.before}: </span>
                  {renderValue(proposal.before)}
                </del>
                <ArrowRight aria-hidden="true" className="text-ink-subtle size-3.5 shrink-0" />
              </>
            )}
            <ins
              data-slot="proposal-after"
              className="text-ink bg-accent-soft rounded-xs px-1 font-medium no-underline"
            >
              <span className="sr-only">{text.after}: </span>
              {renderValue(proposal.after)}
            </ins>
          </p>
          <div data-slot="proposal-meta" className="flex flex-wrap items-center gap-2">
            <ProvenanceChip source={proposal.source} anchor={anchor} offline={offline} />
            {confidence === undefined ? null : (
              <span data-slot="proposal-confidence" className="text-ink-muted text-xs tabular-nums">
                {text.confidence(confidence)}
              </span>
            )}
            <LevelBadge level={proposal.level} />
          </div>
          {inlineError ? (
            <p
              id={errorId}
              role="alert"
              data-slot="proposal-error"
              className="text-danger bg-danger-soft rounded-md px-3 py-2 text-sm"
            >
              {inlineError}
            </p>
          ) : null}
          {viewOnly ? (
            <p data-slot="proposal-view-only" className="text-ink-muted text-xs">
              {text.viewOnly}
            </p>
          ) : null}
          {offline && !viewOnly ? (
            <p data-slot="proposal-offline" className="text-ink-muted text-xs">
              {text.offline}
            </p>
          ) : null}
        </div>
        {viewOnly ? null : busy ? (
          <div
            data-slot="proposal-confirmed"
            className="text-ink flex h-9 items-center justify-center gap-2 text-sm font-medium md:justify-end"
          >
            <ConfirmCheck reduced={reduced} />
            {text.confirmed}
          </div>
        ) : (
          <div
            data-slot="proposal-actions"
            className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end"
          >
            <ActionButton name="confirm" {...shared} onClick={confirm}>
              {text.confirm}
            </ActionButton>
            <div className="flex flex-1 gap-2 md:flex-none">
              <ActionButton name="edit" {...shared} onClick={() => onEdit?.(proposal)}>
                {text.edit}
              </ActionButton>
              <ActionButton name="dismiss" {...shared} onClick={() => onDismiss?.(proposal)}>
                {text.dismiss}
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Loading placeholder with the card's footprint. */
export function ProposalCardSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="proposal-card-skeleton"
      className={cn('border-line flex flex-col gap-3 rounded-xl border p-4', className)}
      {...props}
    >
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-6 w-40 rounded-full" />
      <Skeleton className="h-9 w-full md:w-64" />
    </div>
  );
}
