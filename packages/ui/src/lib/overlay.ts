// Class recipes shared by every floating layer (popover, menus, tooltip, dialog, sheet, command).
// Floating layers are the only components with shadows; in dark the shadow tokens carry the 1 px
// top highlight (`--shadow-highlight`). Motion uses the duration and easing tokens, which
// `tokens/motion.css` shortens to 0.01 ms (and `[data-state]` transforms to none) under
// prefers-reduced-motion.

/** Raised panel for floating content: overlay surface, hairline border, elevation. */
export const floatingSurface =
  'bg-surface-overlay text-ink border border-line shadow-3 forced-colors:border-current';

/**
 * Menus and popovers: fade plus a 4 px move away from the trigger over 150 ms `--ease-enter`;
 * close over 100 ms `--ease-exit`. Radix sets `data-state` and `data-side`.
 */
export const menuMotion = [
  'origin-(--radix-popper-transform-origin)',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=open]:duration-(--dur-fast) data-[state=open]:ease-enter',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'data-[state=closed]:duration-(--dur-exit) data-[state=closed]:ease-exit',
  'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
  'data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1',
  'data-[side=bottom]:data-[state=closed]:slide-out-to-top-1',
  'data-[side=top]:data-[state=closed]:slide-out-to-bottom-1',
  'data-[side=left]:data-[state=closed]:slide-out-to-right-1',
  'data-[side=right]:data-[state=closed]:slide-out-to-left-1',
].join(' ');

/** Dim layer behind modal content. */
export const scrim = [
  'fixed inset-0 z-overlay bg-ink/30 dark:bg-surface-sunken/80',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=open]:duration-(--dur-base) data-[state=open]:ease-standard',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'data-[state=closed]:duration-(--dur-exit) data-[state=closed]:ease-exit',
].join(' ');

/** Row layout shared by menus and the command palette (state styling is added per library). */
export const menuItemBase = [
  'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-ink',
  'outline-none select-none pointer-coarse:min-h-(--hit)',
  'data-[variant=destructive]:text-danger',
  '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted',
].join(' ');

/** Rows in dropdown, context and menubar menus (Radix item states). 44 px on coarse pointers. */
export const menuItem = [
  menuItemBase,
  'data-highlighted:bg-surface-sunken forced-colors:data-highlighted:outline',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
].join(' ');

/** Menu content box shared by dropdown, context and menubar menus. */
export const menuContent = [
  'z-popover min-w-48 max-w-(--radix-popper-available-width) overflow-x-hidden overflow-y-auto',
  'max-h-(--radix-popper-available-height) rounded-md p-1',
  floatingSurface,
  menuMotion,
].join(' ');

export const menuLabel = 'px-2 py-1.5 text-xs font-medium text-ink-subtle';
export const menuSeparator = '-mx-1 my-1 h-px bg-line';
export const menuShortcut = 'ms-auto text-xs tracking-wide text-ink-subtle';

/** Visible keyboard focus ring used by triggers and inline controls. */
export const focusRing = 'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring';
