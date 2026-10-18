import {
  Ban,
  Camera,
  Cog,
  FileInput,
  FileText,
  Landmark,
  Pencil,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type PointerEvent,
} from 'react';

import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '../../components/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/popover';
import { Skeleton } from '../../components/skeleton';
import { useMediaQuery } from '../../hooks/use-media-query';
import { cn } from '../../lib/cn';
import type { Anchor, ProvenanceKind, ProvenanceSource } from '../types';
import {
  DEFAULT_PROVENANCE_LABELS,
  ProvenancePopoverBody,
  confidencePercent,
  showsConfidence,
  type ProvenanceLabels,
} from './provenance-popover';

/** Devices that can hover precisely get the hover card; everything else gets the bottom sheet. */
export const POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** How long the pointer may travel from chip to card before the card closes. */
export const HOVER_CLOSE_DELAY_MS = 150;

export const PROVENANCE_KIND_ICONS: Record<ProvenanceKind, LucideIcon> = {
  document: FileText,
  capture: Camera,
  adapter: Landmark,
  ai: Sparkles,
  import: FileInput,
  manual: Pencil,
  system: Cog,
};

/**
 * The capsule: 24 px, sunken fill, hairline that turns brass and lifts 1 px on hover or focus. Long
 * labels (Tamil, Kannada) wrap inside it instead of clipping, so the height is a minimum.
 */
export const provenanceChipClasses = [
  'group/chip relative inline-flex min-h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full',
  'border border-line bg-surface-sunken px-2 text-start font-sans text-xs font-medium text-ink-muted',
  'transition-[translate,border-color] duration-(--dur-fast) ease-standard',
  'hover:-translate-y-px hover:border-seal focus-visible:-translate-y-px focus-visible:border-seal',
  'data-[state=open]:border-seal',
  'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
  'disabled:pointer-events-none disabled:opacity-50',
  '[&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0',
  // Touch: a 44 px hit area around the 24 px capsule.
  'pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5',
  'forced-colors:border-current',
].join(' ');

/** Pointer hover card: 320 px, radius 12, opens above the chip so the 4 px slide is a rise. */
export const provenancePopoverClasses = 'w-80 rounded-xl p-4';

export interface ProvenanceChipProps extends Omit<
  ComponentProps<'button'>,
  'children' | 'onClick' | 'type'
> {
  /** Required: a fact without a source cannot be rendered. */
  source: ProvenanceSource;
  /** The document excerpt `source.anchorId` points at, for the popover. */
  anchor?: Anchor | undefined;
  onOpenSource?: (() => void) | undefined;
  onReportWrong?: (() => void) | undefined;
  /** Read-only: the source still opens, its actions are disabled with the reason. */
  offline?: boolean | undefined;
  /** Permission denied: actions are hidden and a view-only note is shown. */
  viewOnly?: boolean | undefined;
  labels?: Partial<ProvenanceLabels> | undefined;
  /** `auto` follows the device (POINTER_QUERY); force one for previews and tests. */
  presentation?: 'auto' | 'popover' | 'sheet';
  /** Controlled open state (stories and tests). */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function StateMark({ source }: { source: ProvenanceSource }) {
  if (source.kind === 'manual' || source.state === 'edited') {
    return <Pencil aria-hidden="true" data-slot="provenance-pencil" className="text-seal" />;
  }
  if (source.state === 'rejected') {
    return <Ban aria-hidden="true" data-slot="provenance-rejected" className="text-danger" />;
  }
  return (
    <span
      aria-hidden="true"
      data-slot="provenance-state-dot"
      data-state-mark={source.state}
      className={cn(
        'border-seal size-1.5 shrink-0 rounded-full border forced-colors:border-current',
        source.state === 'confirmed' && 'bg-seal forced-colors:bg-[CanvasText]',
      )}
    />
  );
}

/**
 * The product's signature: where a fact came from and whether it is confirmed. Hover, focus or tap
 * opens the quoted source; on touch it is a bottom sheet, with no hover behaviour at all.
 */
export function ProvenanceChip({
  source,
  anchor,
  onOpenSource,
  onReportWrong,
  offline,
  viewOnly,
  labels,
  presentation = 'auto',
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: ProvenanceChipProps) {
  const text = { ...DEFAULT_PROVENANCE_LABELS, ...labels };
  const finePointer = useMediaQuery(POINTER_QUERY);
  const pointer = presentation === 'auto' ? finePointer : presentation === 'popover';
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  // 'preview': opened by hover or focus, focus stays on the chip (tooltip-style card).
  // 'dialog': opened by click, Enter or Space; keyboard activation moves focus into the card.
  const [mode, setMode] = useState<'preview' | 'dialog'>('dialog');
  const focusIntoCard = useRef(false);
  const ignoreNextFocus = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = useId();

  const setOpen = (next: boolean) => {
    // Closing from inside the card returns focus to the chip; that focus must not reopen it.
    if (!next && cardRef.current?.contains(document.activeElement)) ignoreNextFocus.current = true;
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

  const manual = source.kind === 'manual';
  const KindIcon = PROVENANCE_KIND_ICONS[source.kind];
  const confidence =
    showsConfidence(source) && source.confidence !== undefined
      ? confidencePercent(source.confidence)
      : undefined;
  const label = manual ? text.enteredByYou : source.label;
  const ariaLabel = text.chip({
    label,
    title: anchor?.documentTitle ?? label,
    page: anchor?.page ?? source.page,
    state: text[source.state],
    confidence,
  });

  const chip = (
    <button
      type="button"
      data-slot="provenance-chip"
      data-kind={source.kind}
      data-source-state={source.state}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      className={cn(provenanceChipClasses, className)}
      {...props}
    >
      <StateMark source={source} />
      <KindIcon aria-hidden="true" data-slot="provenance-kind-icon" data-icon={source.kind} />
      <span
        className={cn('min-w-0 wrap-break-word', source.state === 'rejected' && 'line-through')}
      >
        {label}
      </span>
      {showsConfidence(source) ? (
        <span
          aria-hidden="true"
          data-slot="provenance-confidence-dot"
          className="bg-warning size-1.5 shrink-0 rounded-full forced-colors:bg-[CanvasText]"
        />
      ) : null}
    </button>
  );

  const body = (
    <ProvenancePopoverBody
      source={source}
      anchor={anchor}
      labels={labels}
      onOpenSource={onOpenSource}
      onReportWrong={onReportWrong}
      offline={offline}
      viewOnly={viewOnly}
    />
  );

  if (!pointer) {
    // Touch and coarse pointers: a modal bottom sheet opened by tap only.
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{chip}</DrawerTrigger>
        <DrawerContent aria-describedby={undefined} data-slot="provenance-sheet">
          <ProvenancePopoverBody
            className="p-4"
            source={source}
            anchor={anchor}
            labels={labels}
            onOpenSource={onOpenSource}
            onReportWrong={onReportWrong}
            offline={offline}
            viewOnly={viewOnly}
            renderTitle={(title) => (
              <DrawerTitle className="font-sans text-sm font-medium">{title}</DrawerTitle>
            )}
          />
        </DrawerContent>
      </Drawer>
    );
  }

  const fromMouse = (event: PointerEvent) => event.pointerType !== 'touch';

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <PopoverTrigger
        asChild
        onClick={(event: MouseEvent) => {
          // Clicks open (never toggle): hover or focus has usually opened the card already.
          event.preventDefault();
          cancelClose();
          setMode('dialog');
          const keyboard = event.detail === 0;
          if (open) {
            if (keyboard) cardRef.current?.querySelector<HTMLElement>('button')?.focus();
            return;
          }
          focusIntoCard.current = keyboard;
          setOpen(true);
        }}
        onPointerEnter={(event: PointerEvent<HTMLButtonElement>) => {
          onPointerEnter?.(event);
          if (!fromMouse(event) || props.disabled) return;
          cancelClose();
          if (!open) {
            setMode('preview');
            focusIntoCard.current = false;
            setOpen(true);
          }
        }}
        onPointerLeave={(event: PointerEvent<HTMLButtonElement>) => {
          onPointerLeave?.(event);
          if (fromMouse(event) && mode === 'preview') scheduleClose();
        }}
        onFocus={(event) => {
          onFocus?.(event);
          if (ignoreNextFocus.current) {
            ignoreNextFocus.current = false;
            return;
          }
          if (!open) {
            setMode('preview');
            focusIntoCard.current = false;
            setOpen(true);
          }
        }}
        onBlur={(event) => {
          onBlur?.(event);
          ignoreNextFocus.current = false;
          const next = event.relatedTarget as Node | null;
          if (mode === 'preview' && !cardRef.current?.contains(next)) setOpen(false);
        }}
        aria-describedby={open && mode === 'preview' ? cardId : undefined}
      >
        {chip}
      </PopoverTrigger>
      <PopoverContent
        ref={cardRef}
        id={cardId}
        side="top"
        role={mode === 'preview' ? 'tooltip' : 'dialog'}
        aria-label={mode === 'dialog' ? ariaLabel : undefined}
        data-slot="provenance-card"
        data-mode={mode}
        className={provenancePopoverClasses}
        onOpenAutoFocus={(event) => {
          if (!focusIntoCard.current) event.preventDefault();
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={(event) => {
          if (fromMouse(event) && mode === 'preview') scheduleClose();
        }}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}

/** Loading placeholder with the chip's footprint. */
export function ProvenanceChipSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return <Skeleton className={cn('h-6 w-24 rounded-full', className)} {...props} />;
}
