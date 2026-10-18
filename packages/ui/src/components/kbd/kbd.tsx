import type { ComponentProps } from 'react';

import {
  DEFAULT_HOTKEY_LABELS,
  formatHotkeyLabel,
  useIsMac,
  type HotkeyLabels,
} from '../../hooks/use-hotkey';
import { cn } from '../../lib/cn';

export interface KbdProps extends ComponentProps<'kbd'> {
  /** A hotkey such as `mod+k` or `g then t`, shown with platform-aware symbols (⌘K or Ctrl+K). */
  hotkey?: string;
  /** Override platform detection (stories, server rendering). */
  mac?: boolean;
  labels?: Partial<HotkeyLabels>;
}

/** Keyboard key or shortcut hint. */
export function Kbd({ hotkey, mac, labels, className, children, ...props }: KbdProps) {
  const detectedMac = useIsMac();
  const label =
    hotkey === undefined
      ? children
      : formatHotkeyLabel(hotkey, mac ?? detectedMac, { ...DEFAULT_HOTKEY_LABELS, ...labels });
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center gap-1 px-1.5',
        'border-line-strong bg-surface-sunken shadow-1 rounded-xs border',
        'text-ink-muted font-mono text-xs tabular-nums',
        className,
      )}
      {...props}
    >
      {label}
    </kbd>
  );
}
