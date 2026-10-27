import {
  CircleAlert,
  CircleCheckBig,
  CircleHelp,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '../../components/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/popover';
import { useMediaQuery } from '../../hooks/use-media-query';
import { cn } from '../../lib/cn';
import { HOVER_CLOSE_DELAY_MS, POINTER_QUERY } from '../provenance-chip/provenance-chip';
import {
  FactCardBody,
  type FactCardActions,
  type FactCardLabels,
  type FactSource,
} from './fact-card';

/** Mirrors the drafting fact-check verdicts; kept local so the UI package does not import drafting. */
export type FactStatus = 'match' | 'mismatch' | 'unsupported' | 'unverified-citation' | 'ambiguous';

export const FACT_STATUS_ORDER: readonly FactStatus[] = [
  'mismatch',
  'ambiguous',
  'unverified-citation',
  'unsupported',
  'match',
];

export interface FactStatusMeta {
  Icon: LucideIcon;
  /** Literal utilities so Tailwind sees them. */
  classes: string;
  /** Icon colour in the card. */
  tone: string;
}

/** 1.5 px wavy underline in the verdict's token; dotted for unsupported; none for a match. */
const SQUIGGLE =
  'cursor-pointer rounded-xs bg-transparent p-0 text-inherit [font:inherit] underline decoration-[1.5px] underline-offset-4 [text-decoration-skip-ink:none] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring forced-colors:decoration-[LinkText]';

export const FACT_STATUS_META: Record<FactStatus, FactStatusMeta> = {
  mismatch: {
    Icon: CircleAlert,
    classes: `${SQUIGGLE} decoration-wavy decoration-danger`,
    tone: 'text-danger',
  },
  ambiguous: {
    Icon: TriangleAlert,
    classes: `${SQUIGGLE} decoration-wavy decoration-warning`,
    tone: 'text-warning',
  },
  'unverified-citation': {
    Icon: SearchX,
    classes: `${SQUIGGLE} decoration-wavy decoration-warning`,
    tone: 'text-warning',
  },
  unsupported: {
    Icon: CircleHelp,
    classes: `${SQUIGGLE} decoration-dotted decoration-ink-muted`,
    tone: 'text-ink-muted',
  },
  match: {
    Icon: CircleCheckBig,
    classes: 'cursor-text bg-transparent p-0 text-inherit [font:inherit] no-underline',
    tone: 'text-success',
  },
};

export interface FactLabels extends FactCardLabels {
  status: Record<FactStatus, string>;
  /** Live-region text when keyboard navigation lands on an issue. */
  announce: (args: { index: number; total: number; status: string }) => string;
  noIssues: string;
}

export const DEFAULT_FACT_LABELS: FactLabels = {
  status: {
    mismatch: 'Does not match the record',
    ambiguous: 'Ambiguous in the record',
    'unverified-citation': 'Citation not verified',
    unsupported: 'Not found in the record',
    match: 'Matches the record',
  },
  source: 'From the record',
  noSource: 'The record has no passage for this.',
  fix: 'Fix',
  ignore: 'Ignore',
  ignoreForMatter: 'Ignore for this matter',
  markAssertion: 'Mark as my assertion',
  page: (page) => `Page ${String(page)}`,
  openPage: (page) => `Open page ${String(page)}`,
  announce: ({ index, total, status }) => `Issue ${String(index)} of ${String(total)}: ${status}`,
  noIssues: 'No fact-check issues.',
};

export interface FactSquiggleProps
  extends FactCardActions, Omit<ComponentProps<'button'>, 'children' | 'type' | 'onClick'> {
  status: FactStatus;
  /** The claim text as written in the draft. */
  children: ReactNode;
  /** The record passage the verdict rests on. */
  source?: FactSource | undefined;
  labels?: Partial<FactLabels> | undefined;
  /** `auto` follows the device (POINTER_QUERY); force one for previews and tests. */
  presentation?: 'auto' | 'popover' | 'sheet';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A claim in the draft with a spell-check style underline that follows its verdict. Hover, focus or
 * tap opens the verdict card (a bottom sheet on touch). A match carries no underline.
 */
export function FactSquiggle({
  status,
  children,
  source,
  labels,
  presentation = 'auto',
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onFix,
  onIgnore,
  onIgnoreForMatter,
  onMarkAssertion,
  onOpenPage,
  className,
  ...props
}: FactSquiggleProps) {
  const text = { ...DEFAULT_FACT_LABELS, ...labels };
  const finePointer = useMediaQuery(POINTER_QUERY);
  const popover = presentation === 'auto' ? finePointer : presentation === 'popover';
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const hovered = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleId = useId();
  const meta = FACT_STATUS_META[status];

  const setOpen = (next: boolean) => {
    if (!next) hovered.current = false;
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  const cancelClose = () => {
    clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);

  const actions = (
    <FactCardBody
      status={status}
      statusLabel={text.status[status]}
      Icon={meta.Icon}
      tone={meta.tone}
      source={source}
      labels={text}
      titleId={titleId}
      onFix={onFix}
      onIgnore={onIgnore}
      onIgnoreForMatter={onIgnoreForMatter}
      onMarkAssertion={onMarkAssertion}
      onOpenPage={onOpenPage}
      onDone={() => {
        setOpen(false);
      }}
    />
  );

  const trigger = (
    <button
      type="button"
      data-slot="fact-squiggle"
      data-status={status}
      aria-haspopup="dialog"
      aria-label={`${text.status[status]}: ${typeof children === 'string' ? children : ''}`.replace(
        /: $/,
        '',
      )}
      className={cn(meta.classes, className)}
      onPointerEnter={(event) => {
        if (!popover || event.pointerType === 'touch' || status === 'match') return;
        cancelClose();
        if (!open) {
          hovered.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={() => {
        if (popover && hovered.current) scheduleClose();
      }}
      {...props}
    >
      {children}
    </button>
  );

  if (status === 'match' && !open) return trigger;

  if (!popover) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent aria-labelledby={titleId} className="p-4">
          <DrawerTitle className="sr-only">{text.status[status]}</DrawerTitle>
          {actions}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        aria-labelledby={titleId}
        className="data-[state=open]:zoom-in-95 w-80 rounded-xl p-4 motion-reduce:animate-none"
        onOpenAutoFocus={(event) => {
          // A hover preview keeps focus where it is; keyboard and tap move into the card.
          if (hovered.current) event.preventDefault();
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={() => {
          if (hovered.current) scheduleClose();
        }}
      >
        {actions}
      </PopoverContent>
    </Popover>
  );
}

/** Polite live region for the keyboard-navigation announcement (see useFactNavigation). */
export function FactLiveRegion({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" data-slot="fact-live-region" className="sr-only">
      {message}
    </div>
  );
}
