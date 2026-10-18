'use client';

// Shell code that is not needed for first paint: the Radix overlay primitives (switcher popover and
// phone sheet, user menu, rail tooltips, the More and capture sheets) and the animated nav
// indicator. It lives in its own chunk, loaded at idle by use-shell-overlays.ts, so it stays out of
// the initial route JS (#11: the shell adds at most 40 KB gzip). Until it loads, the shell renders
// static equivalents.
import { listSpring } from '@causedeck/ui/motion';
import { LazyMotion, MotionConfig, domMax } from 'motion/react';
import * as m from 'motion/react-m';

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@causedeck/ui/dropdown-menu';
export { Popover, PopoverContent, PopoverTrigger } from '@causedeck/ui/popover';
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@causedeck/ui/sheet';
export { Tooltip, TooltipContent, TooltipTrigger } from '@causedeck/ui/tooltip';

/**
 * The active nav item's 2 px accent bar. A shared `layoutId` makes it spring between items
 * (`{ stiffness: 420, damping: 34 }`); `reducedMotion="user"` makes the move instant under
 * `prefers-reduced-motion`.
 */
export function NavActiveIndicator({ className }: { className: string }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <m.span
          layoutId="sidebar-active"
          data-active-indicator="animated"
          transition={listSpring}
          aria-hidden="true"
          className={className}
        />
      </MotionConfig>
    </LazyMotion>
  );
}
