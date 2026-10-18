import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import {
  Button,
  DEFAULT_BUTTON_LABELS,
  type ButtonProps,
  type ButtonVariant,
} from '../button/button';

/** Square sizes on the button scale: 32, 36 and 44 px. */
const SQUARE = { sm: 'size-8 px-0', md: 'size-9 px-0', lg: 'size-11 px-0' } as const;

export type IconButtonVariant = Exclude<ButtonVariant, 'link'>;

export interface IconButtonProps extends Omit<ButtonProps, 'variant' | 'children' | 'aria-label'> {
  /** Accessible name (and native tooltip). Required: the button shows only an icon. */
  label: string;
  /** The icon, e.g. a lucide-react icon. It is hidden from assistive tech. */
  children: ReactNode;
  variant?: IconButtonVariant;
}

/** Icon-only button. The `label` names it for screen readers and as a native tooltip. */
export function IconButton({
  label,
  labels,
  loading = false,
  variant = 'ghost',
  size = 'md',
  title,
  className,
  children,
  ...props
}: IconButtonProps) {
  const text = { ...DEFAULT_BUTTON_LABELS, ...labels };
  return (
    <Button
      data-slot="icon-button"
      variant={variant}
      size={size}
      loading={loading}
      labels={text}
      aria-label={loading ? `${label} ${text.loading}` : label}
      title={title ?? label}
      className={cn(SQUARE[size], className)}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </Button>
  );
}
