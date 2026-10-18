import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { buttonVariants, type ButtonSize } from '../button/button';

export interface PaginationLabels {
  /** Accessible name of the pagination landmark. */
  nav: string;
  previous: string;
  next: string;
  /** Accessible names of the previous and next links. */
  goToPrevious: string;
  goToNext: string;
  /** Screen-reader text for skipped pages. */
  more: string;
}

export const DEFAULT_PAGINATION_LABELS: PaginationLabels = {
  nav: 'Pagination',
  previous: 'Previous',
  next: 'Next',
  goToPrevious: 'Go to previous page',
  goToNext: 'Go to next page',
  more: 'More pages',
};

export interface PaginationProps extends ComponentProps<'nav'> {
  labels?: Partial<PaginationLabels> | undefined;
}

export function Pagination({ labels, className, ...props }: PaginationProps) {
  const text = { ...DEFAULT_PAGINATION_LABELS, ...labels };
  return (
    <nav
      data-slot="pagination"
      aria-label={text.nav}
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  );
}

export function PaginationContent({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex flex-row flex-wrap items-center gap-1', className)}
      {...props}
    />
  );
}

export function PaginationItem(props: ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />;
}

export interface PaginationLinkProps extends ComponentProps<'a'> {
  isActive?: boolean;
  /** Disabled links are not focusable and announce `aria-disabled`. */
  disabled?: boolean;
  size?: ButtonSize;
}

export function PaginationLink({
  isActive = false,
  disabled = false,
  size = 'md',
  className,
  href,
  ...props
}: PaginationLinkProps) {
  return (
    <a
      data-slot="pagination-link"
      data-active={isActive ? '' : undefined}
      aria-current={isActive ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      href={disabled ? undefined : href}
      role={disabled ? 'link' : undefined}
      className={cn(
        buttonVariants({ variant: isActive ? 'outline' : 'ghost', size }),
        'min-w-9 px-2.5 tabular-nums',
        isActive && 'border-line-strong',
        className,
      )}
      {...props}
    />
  );
}

export interface PaginationStepProps extends Omit<PaginationLinkProps, 'isActive'> {
  labels?: Partial<PaginationLabels> | undefined;
}

export function PaginationPrevious({ labels, className, children, ...props }: PaginationStepProps) {
  const text = { ...DEFAULT_PAGINATION_LABELS, ...labels };
  return (
    <PaginationLink
      data-slot="pagination-previous"
      aria-label={text.goToPrevious}
      className={cn('gap-1 px-2.5', className)}
      {...props}
    >
      <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
      <span>{children ?? text.previous}</span>
    </PaginationLink>
  );
}

export function PaginationNext({ labels, className, children, ...props }: PaginationStepProps) {
  const text = { ...DEFAULT_PAGINATION_LABELS, ...labels };
  return (
    <PaginationLink
      data-slot="pagination-next"
      aria-label={text.goToNext}
      className={cn('gap-1 px-2.5', className)}
      {...props}
    >
      <span>{children ?? text.next}</span>
      <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
    </PaginationLink>
  );
}

export interface PaginationEllipsisProps extends ComponentProps<'span'> {
  labels?: Partial<PaginationLabels> | undefined;
}

export function PaginationEllipsis({ labels, className, ...props }: PaginationEllipsisProps) {
  const text = { ...DEFAULT_PAGINATION_LABELS, ...labels };
  return (
    <span
      data-slot="pagination-ellipsis"
      className={cn('text-ink-subtle inline-flex size-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal aria-hidden="true" className="size-4" />
      <span className="sr-only">{text.more}</span>
    </span>
  );
}
