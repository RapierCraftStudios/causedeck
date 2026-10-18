import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { focusRing } from '../../lib/overlay';

export interface BreadcrumbLabels {
  /** Accessible name of the breadcrumb navigation landmark. */
  nav: string;
  /** Screen-reader text for collapsed middle levels. */
  more: string;
}

export const DEFAULT_BREADCRUMB_LABELS: BreadcrumbLabels = {
  nav: 'Breadcrumb',
  more: 'More pages',
};

export interface BreadcrumbProps extends ComponentProps<'nav'> {
  labels?: Partial<BreadcrumbLabels> | undefined;
}

export function Breadcrumb({ labels, ...props }: BreadcrumbProps) {
  const text = { ...DEFAULT_BREADCRUMB_LABELS, ...labels };
  return <nav data-slot="breadcrumb" aria-label={text.nav} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'text-ink-muted flex flex-wrap items-center gap-1.5 text-sm break-words',
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
      {...props}
    />
  );
}

export interface BreadcrumbLinkProps extends ComponentProps<'a'> {
  /** Render the child (e.g. a Next.js `Link`) with link styling. */
  asChild?: boolean;
}

export function BreadcrumbLink({ asChild = false, className, ...props }: BreadcrumbLinkProps) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn(
        'inline-flex min-w-0 items-center gap-1 rounded-xs underline-offset-4',
        'hover:text-ink active:text-ink hover:underline',
        'ease-standard transition-colors duration-(--dur-fast)',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      aria-current="page"
      className={cn('text-ink min-w-0 truncate font-medium', className)}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({ className, children, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn('text-ink-subtle [&_svg]:size-3.5 rtl:[&_svg]:rotate-180', className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  );
}

export interface BreadcrumbEllipsisProps extends ComponentProps<'span'> {
  labels?: Partial<BreadcrumbLabels> | undefined;
}

export function BreadcrumbEllipsis({ labels, className, ...props }: BreadcrumbEllipsisProps) {
  const text = { ...DEFAULT_BREADCRUMB_LABELS, ...labels };
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      className={cn('inline-flex size-6 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal aria-hidden="true" className="size-4" />
      <span className="sr-only">{text.more}</span>
    </span>
  );
}
