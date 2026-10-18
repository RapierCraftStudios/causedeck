import { createContext, useContext, type ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/** Row density: comfortable rows are 44 px, compact rows 32 px. */
export type TableDensity = 'comfortable' | 'compact';

/** Row heights per density (the `--space-1` scale: 11 = 44 px, 8 = 32 px). */
export const TABLE_ROW_HEIGHT: Record<TableDensity, string> = {
  comfortable: 'h-11',
  compact: 'h-8',
};

const DensityContext = createContext<TableDensity>('comfortable');

/** The density of the surrounding `Table`. */
export function useTableDensity(): TableDensity {
  return useContext(DensityContext);
}

export interface TableProps extends ComponentProps<'table'> {
  density?: TableDensity | undefined;
  /** Classes for the scroll container around the table (e.g. a max height for a sticky header). */
  containerClassName?: string | undefined;
  /** Props for the scroll container (e.g. a ref for virtualisation). */
  containerProps?: Omit<ComponentProps<'div'>, 'className' | 'children'> | undefined;
}

/**
 * Semantic table in a scroll container. Numerals are tabular so columns of figures line up; the
 * density sets every row's height (44 px comfortable, 32 px compact).
 */
export function Table({
  density = 'comfortable',
  containerClassName,
  containerProps,
  className,
  ...props
}: TableProps) {
  return (
    <DensityContext.Provider value={density}>
      <div
        data-slot="table-container"
        {...containerProps}
        className={cn('relative w-full overflow-auto', containerClassName)}
      >
        <table
          data-slot="table"
          data-density={density}
          className={cn(
            'text-ink w-full caption-bottom border-collapse font-sans text-sm tabular-nums',
            className,
          )}
          {...props}
        />
      </div>
    </DensityContext.Provider>
  );
}

export interface TableHeaderProps extends ComponentProps<'thead'> {
  /** Keep the header row visible while the container scrolls. */
  sticky?: boolean | undefined;
}

export function TableHeader({ sticky = false, className, ...props }: TableHeaderProps) {
  return (
    <thead
      data-slot="table-header"
      data-sticky={sticky ? '' : undefined}
      className={cn(
        'bg-surface-raised [&_tr]:border-line-strong [&_tr]:border-b',
        sticky && 'z-sticky sticky top-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-b-0', className)}
      {...props}
    />
  );
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-line-strong bg-surface-sunken border-t font-medium', className)}
      {...props}
    />
  );
}

/**
 * Classes shared by `TableRow` and virtualised rows: hover `--surface-sunken`; selected
 * (`data-state="selected"`) `--accent-soft` with a 2 px inline-start accent bar. The bar is a
 * border that is always present (transparent until selected) so selecting never shifts layout.
 */
export const tableRowClasses = [
  'border-b border-line border-s-2 border-s-transparent',
  'transition-colors duration-(--dur-fast) ease-standard motion-reduce:transition-none',
  'hover:bg-surface-sunken',
  'data-[state=selected]:border-s-accent data-[state=selected]:bg-accent-soft',
  'data-[state=selected]:hover:bg-accent-soft',
  'forced-colors:data-[state=selected]:border-s-current',
].join(' ');

export interface TableRowProps extends ComponentProps<'tr'> {
  /** Shows the selected style; the row also needs `aria-selected` when it is selectable. */
  selected?: boolean | undefined;
  /** Overrides the table density for this row. */
  density?: TableDensity | undefined;
}

export function TableRow({ selected, density, className, ...props }: TableRowProps) {
  const tableDensity = useTableDensity();
  return (
    <tr
      data-slot="table-row"
      data-state={selected ? 'selected' : undefined}
      className={cn(tableRowClasses, TABLE_ROW_HEIGHT[density ?? tableDensity], className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-ink-muted h-10 px-3 text-start align-middle text-xs font-medium whitespace-nowrap',
        '[&:has([role=checkbox])]:w-10 [&:has([role=checkbox])]:pe-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'px-3 py-0 align-middle',
        '[&:has([role=checkbox])]:w-10 [&:has([role=checkbox])]:pe-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-ink-subtle mt-3 text-xs', className)}
      {...props}
    />
  );
}
