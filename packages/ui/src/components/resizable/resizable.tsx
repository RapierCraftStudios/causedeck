import { GripVertical } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

import { cn } from '../../lib/cn';

export type ResizablePanelGroupProps = ComponentProps<typeof Group>;

/** Row (default) or column of resizable panels. Arrow keys resize from a focused handle. */
export function ResizablePanelGroup({ className, ...props }: ResizablePanelGroupProps) {
  return <Group data-slot="resizable-panel-group" className={cn(className)} {...props} />;
}

export type ResizablePanelProps = ComponentProps<typeof Panel>;

export function ResizablePanel(props: ResizablePanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

export interface ResizableHandleLabels {
  /** Accessible name of the focusable resize handle. */
  handle: string;
}

export const DEFAULT_RESIZABLE_LABELS: ResizableHandleLabels = { handle: 'Resize' };

export interface ResizableHandleProps extends ComponentProps<typeof Separator> {
  /** Show a visible grip in the middle of the handle. */
  withHandle?: boolean;
  labels?: Partial<ResizableHandleLabels>;
}

/**
 * Drag or keyboard handle between panels: a 1 px `--line` with a wider invisible hit area.
 * `aria-orientation` is the line's own orientation (vertical inside a horizontal group).
 */
export function ResizableHandle({
  withHandle = false,
  labels,
  className,
  ...props
}: ResizableHandleProps) {
  const text = { ...DEFAULT_RESIZABLE_LABELS, ...labels };
  return (
    <Separator
      data-slot="resizable-handle"
      aria-label={text.handle}
      className={cn(
        'group/handle bg-line relative flex w-px shrink-0 items-center justify-center',
        'ease-standard transition-colors duration-(--dur-fast)',
        'data-[separator=hover]:bg-line-strong data-[separator=active]:bg-accent',
        'focus-visible:outline-ring outline-offset-2 focus-visible:outline-2',
        'aria-disabled:opacity-50',
        // Hit area: 8 px either side of the hairline, 44 px total on touch.
        'after:absolute after:inset-y-0 after:start-1/2 after:w-4 after:-translate-x-1/2 rtl:after:translate-x-1/2',
        'pointer-coarse:after:w-(--hit)',
        'aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full',
        'aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:start-0',
        'aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-4',
        'aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0',
        'aria-[orientation=horizontal]:after:-translate-y-1/2',
        'aria-[orientation=horizontal]:pointer-coarse:after:h-(--hit)',
        'forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none',
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <span
          data-slot="resizable-grip"
          aria-hidden="true"
          className={cn(
            'border-line-strong bg-surface-raised text-ink-muted flex h-4 w-3 items-center justify-center rounded-xs border',
            'group-aria-[orientation=horizontal]/handle:rotate-90',
          )}
        >
          <GripVertical className="size-2.5" />
        </span>
      ) : null}
    </Separator>
  );
}
