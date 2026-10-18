import { Separator as SeparatorPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export type SeparatorProps = ComponentProps<typeof SeparatorPrimitive.Root>;

/** 1 px hairline in `--line`. Decorative unless `decorative={false}` (then role=separator). */
export function Separator({
  orientation = 'horizontal',
  decorative = true,
  className,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'bg-line shrink-0',
        'data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full',
        'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        // Forced colours repaint backgrounds; keep the line in the system text colour.
        'forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none',
        className,
      )}
      {...props}
    />
  );
}
