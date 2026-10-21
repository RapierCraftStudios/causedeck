'use client';

import {
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  metaHelper,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type Column,
  type ColumnVisibilityState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Lock, WifiOff } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { useMediaQuery } from '../../hooks/use-media-query';
import { cn } from '../../lib/cn';
import { Alert, AlertDescription, AlertTitle } from '../alert/alert';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';
import { EmptyState } from '../empty-state/empty-state';
import { Skeleton, SkeletonGroup } from '../skeleton/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_FINE_POINTER_QUERY,
  type TableDensity,
} from '../table/table';
import { ToggleGroup, ToggleGroupItem } from '../toggle-group/toggle-group';

/** Per-column extras: a plain-text name for menus and cards, and numeric alignment. */
export interface DataTableColumnMeta {
  /** Plain-text column name, used by the column menu when `header` is not a string. */
  label?: string;
  /** `end` right-aligns figures (amounts, counts) in LTR, left-aligns in RTL. */
  align?: 'start' | 'end';
}

/** Features every `DataTable` registers: sorting, column visibility and row selection. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  columnVisibilityFeature,
  rowSelectionFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof dataTableFeatures;

/** Typed column builder for `DataTable`: `const col = createDataTableColumnHelper<Matter>()`. */
export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

/** A column definition accepted by `DataTable` (build them with `createDataTableColumnHelper`). */
export type DataTableColumnDef<TData extends RowData> = ReturnType<
  ReturnType<typeof createDataTableColumnHelper<TData>>['columns']
>[number];

export type DataTableRow<TData extends RowData> = Row<DataTableFeatures, TData>;

/** Whole-table conditions that replace or annotate the rows. */
export type DataTableStatus = 'error' | 'offline' | 'denied';

export interface DataTableLabels {
  /** Announced once while the skeleton rows show. */
  loading: string;
  /** Default empty-state line when no `empty` slot is given. */
  empty: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  offline: string;
  denied: string;
  selectAll: string;
  selectRow: string;
  columns: string;
  density: string;
  comfortable: string;
  compact: string;
}

export const DEFAULT_DATA_TABLE_LABELS: DataTableLabels = {
  loading: 'Loading',
  empty: 'Nothing here yet.',
  errorTitle: 'Could not load this list.',
  errorDescription: 'Check your connection, then try again.',
  retry: 'Try again',
  offline: 'You are offline. Showing saved data.',
  denied: 'You do not have access to this. Ask the workspace owner.',
  selectAll: 'Select all rows',
  selectRow: 'Select row',
  columns: 'Columns',
  density: 'Row density',
  comfortable: 'Comfortable',
  compact: 'Compact',
};

/** Below this width the table becomes a card list when `mobileRender` is given. */
export const DATA_TABLE_MOBILE_QUERY = '(max-width: 767px)';

/** Row heights in px per density on touch, for virtualisation (match `TABLE_ROW_HEIGHT`). */
export const DATA_TABLE_ROW_PX: Record<TableDensity, number> = { comfortable: 44, compact: 32 };

/** Row heights in px per density with a fine pointer (`TABLE_FINE_POINTER_QUERY`). */
export const DATA_TABLE_ROW_PX_FINE: Record<TableDensity, number> = {
  comfortable: 40,
  compact: 32,
};

export interface DataTableProps<TData extends RowData> {
  /** Accessible name of the table. */
  label: string;
  columns: ReadonlyArray<DataTableColumnDef<TData>>;
  data: ReadonlyArray<TData>;
  /** Stable row id (defaults to the row index). Needed for selection that survives sorting. */
  getRowId?: ((row: TData, index: number) => string) | undefined;
  /** Text naming a row for its selection checkbox, e.g. the matter title. */
  getRowLabel?: ((row: TData) => string) | undefined;

  sorting?: SortingState | undefined;
  defaultSorting?: SortingState | undefined;
  onSortingChange?: ((sorting: SortingState) => void) | undefined;

  columnVisibility?: ColumnVisibilityState | undefined;
  defaultColumnVisibility?: ColumnVisibilityState | undefined;
  onColumnVisibilityChange?: ((visibility: ColumnVisibilityState) => void) | undefined;
  /** Show the column visibility menu in the toolbar. */
  enableColumnVisibility?: boolean | undefined;

  /** Adds a checkbox column; rows select with click, Space and Shift+arrows. */
  enableRowSelection?: boolean | undefined;
  rowSelection?: RowSelectionState | undefined;
  defaultRowSelection?: RowSelectionState | undefined;
  onRowSelectionChange?: ((selection: RowSelectionState) => void) | undefined;

  density?: TableDensity | undefined;
  defaultDensity?: TableDensity | undefined;
  onDensityChange?: ((density: TableDensity) => void) | undefined;
  /** Show the comfortable/compact toggle in the toolbar. */
  enableDensityToggle?: boolean | undefined;

  /** Keep the header visible while the body scrolls (give `className` a max height). */
  stickyHeader?: boolean | undefined;
  /**
   * Render only the rows in view (`@tanstack/react-virtual`). The scroll container gets a max
   * height (`max-h-120` unless `scrollClassName` sets one); the header stays sticky.
   */
  virtualized?: boolean | undefined;
  /** Classes for the scroll container (e.g. `max-h-96`). */
  scrollClassName?: string | undefined;

  /** Show skeleton rows instead of data. */
  loading?: boolean | undefined;
  /** Number of skeleton rows while loading. */
  skeletonRows?: number | undefined;
  /** Shown when there are no rows (defaults to a one-line `EmptyState`). */
  empty?: ReactNode | undefined;
  /** Error (with retry), offline (saved rows stay) or permission-denied (rows hidden). */
  status?: DataTableStatus | undefined;
  /** Called by the error alert's retry button. */
  onRetry?: (() => void) | undefined;

  /** Card renderer used below 768 px instead of the table. */
  mobileRender?: ((row: TData) => ReactNode) | undefined;
  /** `auto` (default) shows cards below 768 px when `mobileRender` is set; force either layout. */
  layout?: 'auto' | 'table' | 'cards' | undefined;
  /**
   * Opens a row: called on a row click and on Enter while the row has focus (table layout). Cards
   * open from a control inside `mobileRender`. Leave out for rows that only select.
   */
  onRowActivate?: ((row: TData, index: number) => void) | undefined;
  /** Called when the focused row changes (arrows, Home/End, Tab or click). */
  onActiveRowChange?: ((row: TData, index: number) => void) | undefined;
  /** Extra classes for a row or card, e.g. a warning tint for refused events. */
  getRowClassName?: ((row: TData) => string | undefined) | undefined;
  /** Extra toolbar content (filters, actions), placed before the built-in controls. */
  toolbar?: ReactNode | undefined;
  labels?: Partial<DataTableLabels> | undefined;
  className?: string | undefined;
}

/** Controlled-or-uncontrolled state: the prop wins when given, otherwise local state. */
function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange: ((next: T) => void) | undefined,
) {
  const [local, setLocal] = useState<T>(defaultValue);
  const current = value === undefined ? local : value;
  const set = (updater: T | ((old: T) => T)) => {
    const next = typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;
    setLocal(next);
    onChange?.(next);
  };
  return [current, set] as const;
}

const EMPTY_SORTING: SortingState = [];
const EMPTY_VISIBILITY: ColumnVisibilityState = {};
const EMPTY_SELECTION: RowSelectionState = {};

/** Plain-text name of a column for menus. */
function columnName<TData extends RowData>(column: Column<DataTableFeatures, TData>): string {
  const { header, meta } = column.columnDef;
  if (meta?.label) return meta.label;
  return typeof header === 'string' ? header : column.id;
}

const SORT_ICON = { asc: ArrowUp, desc: ArrowDown } as const;
const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/**
 * Data table on TanStack Table: sorting, column visibility, sticky header, keyboard row
 * selection, density toggle, skeleton, empty and status states, optional virtualisation and a
 * card list on phones.
 *
 * Keyboard (focus a row with Tab): Up/Down move between rows, Home/End jump, Space toggles the
 * row, Shift+Up/Down extends the selection from the last toggled row, Enter opens the row when
 * `onRowActivate` is given.
 */
export function DataTable<TData extends RowData>({
  label,
  columns,
  data,
  getRowId,
  getRowLabel,
  sorting: sortingProp,
  defaultSorting = EMPTY_SORTING,
  onSortingChange,
  columnVisibility: visibilityProp,
  defaultColumnVisibility = EMPTY_VISIBILITY,
  onColumnVisibilityChange,
  enableColumnVisibility = false,
  enableRowSelection = false,
  rowSelection: selectionProp,
  defaultRowSelection = EMPTY_SELECTION,
  onRowSelectionChange,
  density: densityProp,
  defaultDensity = 'comfortable',
  onDensityChange,
  enableDensityToggle = false,
  stickyHeader = false,
  virtualized = false,
  scrollClassName,
  loading = false,
  skeletonRows = 5,
  empty,
  status,
  onRetry,
  mobileRender,
  layout = 'auto',
  onRowActivate,
  onActiveRowChange,
  getRowClassName,
  toolbar,
  labels,
  className,
}: DataTableProps<TData>) {
  const text = { ...DEFAULT_DATA_TABLE_LABELS, ...labels };
  const [sorting, setSorting] = useControllable(sortingProp, defaultSorting, onSortingChange);
  const [columnVisibility, setColumnVisibility] = useControllable(
    visibilityProp,
    defaultColumnVisibility,
    onColumnVisibilityChange,
  );
  const [rowSelection, setRowSelection] = useControllable(
    selectionProp,
    defaultRowSelection,
    onRowSelectionChange,
  );
  const [density, setDensity] = useControllable(densityProp, defaultDensity, onDensityChange);

  const table = useTable({
    features: dataTableFeatures,
    columns: columns as Array<DataTableColumnDef<TData>>,
    data,
    ...(getRowId ? { getRowId } : {}),
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection,
    enableRowRangeSelection: false,
  });

  const rows = table.getRowModel().rows;
  const narrow = useMediaQuery(DATA_TABLE_MOBILE_QUERY);
  const isMobile = layout === 'auto' ? narrow : layout === 'cards';

  // Keyboard selection: the focused row (roving tabindex), the range anchor and the selection
  // as it was when the anchor was set (Shift+arrows extend from that snapshot).
  const [activeIndex, setActiveIndex] = useState(0);
  const anchor = useRef<{ index: number; base: RowSelectionState } | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusIndex = Math.min(activeIndex, Math.max(rows.length - 1, 0));

  const finePointer = useMediaQuery(TABLE_FINE_POINTER_QUERY);
  const rowPx = (finePointer ? DATA_TABLE_ROW_PX_FINE : DATA_TABLE_ROW_PX)[density];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowPx,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 10,
    enabled: virtualized,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowPx, virtualizer]);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${String(pendingFocus.current)}"]`,
    );
    if (target) {
      target.focus();
      pendingFocus.current = null;
    }
  });

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActiveIndex(next);
    pendingFocus.current = next;
    if (virtualized) virtualizer.scrollToIndex(next);
    return next;
  };

  const selectRange = (from: number, to: number, base: RowSelectionState) => {
    const next: RowSelectionState = { ...base };
    const [start, end] = from < to ? [from, to] : [to, from];
    for (let i = start; i <= end; i += 1) {
      const row = rows[i];
      if (row?.getCanSelect()) next[row.id] = true;
    }
    setRowSelection(next);
  };

  const toggleRow = (index: number, extend: boolean) => {
    const row = rows[index];
    if (!row) return;
    if (extend && anchor.current) {
      selectRange(anchor.current.index, index, anchor.current.base);
      return;
    }
    const willSelect = !row.getIsSelected();
    const next: RowSelectionState = willSelect
      ? { ...rowSelection, [row.id]: true }
      : Object.fromEntries(Object.entries(rowSelection).filter(([id]) => id !== row.id));
    setRowSelection(next);
    anchor.current = { index, base: next };
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' && onRowActivate) {
      const row = rows[index];
      if (row) {
        event.preventDefault();
        onRowActivate(row.original, index);
      }
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = moveTo(index + step);
      if (event.shiftKey && enableRowSelection) {
        anchor.current ??= { index, base: rowSelection };
        selectRange(anchor.current.index, next, anchor.current.base);
      } else if (!event.shiftKey) {
        anchor.current = null;
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : rows.length - 1);
      return;
    }
    if ((event.key === ' ' || event.key === 'Spacebar') && enableRowSelection) {
      event.preventDefault();
      toggleRow(index, false);
    }
  };

  const onCheckboxClick = (event: MouseEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    setActiveIndex(index);
    toggleRow(index, event.shiftKey);
  };

  const visibleColumnCount = table.getVisibleLeafColumns().length + (enableRowSelection ? 1 : 0);
  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const allSelected = table.getIsAllRowsSelected();
  const someSelected = table.getIsSomeRowsSelected();

  const rowCheckbox = (row: DataTableRow<TData>, index: number) => (
    <Checkbox
      tabIndex={-1}
      checked={row.getIsSelected()}
      disabled={!row.getCanSelect()}
      aria-label={getRowLabel ? `${text.selectRow}: ${getRowLabel(row.original)}` : text.selectRow}
      onClick={(event) => {
        onCheckboxClick(event, index);
      }}
    />
  );

  const showToolbar =
    toolbar !== undefined || enableColumnVisibility || (enableDensityToggle && !isMobile);

  const toolbarNode = showToolbar ? (
    <div data-slot="data-table-toolbar" className="flex flex-wrap items-center gap-2">
      {toolbar}
      <div className="ms-auto flex items-center gap-2">
        {enableDensityToggle && !isMobile ? (
          <ToggleGroup
            type="single"
            size="sm"
            aria-label={text.density}
            value={density}
            onValueChange={(value) => {
              if (value === 'comfortable' || value === 'compact') setDensity(value);
            }}
          >
            <ToggleGroupItem value="comfortable">{text.comfortable}</ToggleGroupItem>
            <ToggleGroupItem value="compact">{text.compact}</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        {enableColumnVisibility ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 aria-hidden="true" />
                {text.columns}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{text.columns}</DropdownMenuLabel>
              {hideableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                  onCheckedChange={(checked) => {
                    column.toggleVisibility(checked);
                  }}
                >
                  {columnName(column)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  ) : null;

  const statusAlert =
    status === 'error' ? (
      <Alert
        tone="danger"
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {text.retry}
            </Button>
          ) : undefined
        }
      >
        <AlertTitle>{text.errorTitle}</AlertTitle>
        <AlertDescription>{text.errorDescription}</AlertDescription>
      </Alert>
    ) : status === 'offline' ? (
      <Alert tone="neutral" icon={<WifiOff />}>
        <AlertDescription>{text.offline}</AlertDescription>
      </Alert>
    ) : status === 'denied' ? (
      <Alert tone="neutral" icon={<Lock />}>
        <AlertDescription>{text.denied}</AlertDescription>
      </Alert>
    ) : null;

  const emptyNode = empty ?? <EmptyState title={text.empty} className="py-8" />;

  // Permission denied: no data is shown at all.
  if (status === 'denied') {
    return (
      <div data-slot="data-table" data-status="denied" className={cn('grid gap-3', className)}>
        {statusAlert}
      </div>
    );
  }

  const showRows = !loading && !(status === 'error' && rows.length === 0);

  if (isMobile && mobileRender) {
    return (
      <div
        data-slot="data-table"
        data-layout="cards"
        data-status={status}
        className={cn('grid gap-3', className)}
      >
        {toolbarNode}
        {statusAlert}
        {loading ? (
          <SkeletonGroup labels={{ loading: text.loading }}>
            {Array.from({ length: skeletonRows }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </SkeletonGroup>
        ) : showRows && rows.length === 0 ? (
          emptyNode
        ) : showRows ? (
          <ul aria-label={label} className="grid gap-2">
            {rows.map((row, index) => (
              <li
                key={row.id}
                data-slot="data-table-card"
                data-state={row.getIsSelected() ? 'selected' : undefined}
                className={cn(
                  'border-line bg-surface-raised flex items-start gap-3 rounded-lg border border-s-2 border-s-transparent p-3',
                  'data-[state=selected]:border-s-accent data-[state=selected]:bg-accent-soft',
                  getRowClassName?.(row.original),
                )}
              >
                {enableRowSelection ? (
                  <span className="pt-0.5">{rowCheckbox(row, index)}</span>
                ) : null}
                <div className="min-w-0 flex-1">{mobileRender(row.original)}</div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const virtualItems = virtualized ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualized ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom = virtualized
    ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)
    : 0;
  const rendered = virtualized
    ? virtualItems.flatMap((item) => {
        const row = rows[item.index];
        return row ? [{ row, index: item.index }] : [];
      })
    : rows.map((row, index) => ({ row, index }));

  const tableNode = (
    <Table
      density={density}
      role={enableRowSelection ? 'grid' : undefined}
      aria-label={label}
      aria-multiselectable={enableRowSelection || undefined}
      aria-rowcount={virtualized ? rows.length + 1 : undefined}
      aria-busy={loading || undefined}
      containerProps={{ ref: scrollRef, 'data-slot': 'data-table-scroll' } as object}
      containerClassName={cn(
        'rounded-lg border border-line bg-surface-raised',
        virtualized && 'max-h-120',
        scrollClassName,
      )}
    >
      <TableHeader sticky={stickyHeader || virtualized}>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} aria-rowindex={virtualized ? 1 : undefined}>
            {enableRowSelection ? (
              <TableHead>
                <Checkbox
                  aria-label={text.selectAll}
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  disabled={loading || rows.length === 0}
                  onCheckedChange={(checked) => {
                    table.toggleAllRowsSelected(checked === true);
                    anchor.current = null;
                  }}
                />
              </TableHead>
            ) : null}
            {group.headers.map((header) => {
              const { column } = header;
              const sorted = column.getIsSorted();
              const align = column.columnDef.meta?.align;
              const content = header.isPlaceholder ? null : <table.FlexRender header={header} />;
              if (!column.getCanSort() || header.isPlaceholder) {
                return (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={align === 'end' ? 'text-end' : undefined}
                  >
                    {content}
                  </TableHead>
                );
              }
              const Icon = sorted ? SORT_ICON[sorted] : ChevronsUpDown;
              return (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  aria-sort={sorted ? ARIA_SORT[sorted] : 'none'}
                  className={align === 'end' ? 'text-end' : undefined}
                >
                  <button
                    type="button"
                    data-slot="data-table-sort"
                    onClick={column.getToggleSortingHandler()}
                    className={cn(
                      '-mx-1.5 inline-flex h-7 items-center gap-1 rounded-sm px-1.5',
                      'hover:bg-surface-sunken hover:text-ink',
                      'focus-visible:outline-ring outline-offset-2 focus-visible:outline-2',
                      sorted && 'text-ink',
                      align === 'end' && 'flex-row-reverse',
                    )}
                  >
                    {content}
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: skeletonRows }, (_, i) => (
              <TableRow key={`skeleton-${String(i)}`} data-slot="data-table-skeleton-row">
                {Array.from({ length: visibleColumnCount }, (_, j) => (
                  <TableCell key={j}>
                    <Skeleton
                      className={cn('h-3', j === 0 && enableRowSelection ? 'w-4' : 'w-4/5')}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : null}
        {showRows && rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={visibleColumnCount}>{emptyNode}</TableCell>
          </TableRow>
        ) : null}
        {showRows && paddingTop > 0 ? (
          <tr aria-hidden="true" data-slot="data-table-spacer">
            <td colSpan={visibleColumnCount} style={{ height: paddingTop, padding: 0 }} />
          </tr>
        ) : null}
        {showRows
          ? rendered.map(({ row, index }) => {
              const selected = row.getIsSelected();
              return (
                <TableRow
                  key={row.id}
                  data-row-index={index}
                  aria-rowindex={virtualized ? index + 2 : undefined}
                  aria-selected={enableRowSelection ? selected : undefined}
                  selected={selected}
                  tabIndex={index === focusIndex ? 0 : -1}
                  onKeyDown={(event) => {
                    onRowKeyDown(event, index);
                  }}
                  onFocus={() => {
                    if (index !== activeIndex) setActiveIndex(index);
                    onActiveRowChange?.(row.original, index);
                  }}
                  onClick={
                    onRowActivate
                      ? (event) => {
                          // Clicks on controls inside the row (checkbox, links) keep their own action.
                          const target = event.target as HTMLElement;
                          if (target.closest('button, a, input, [role="checkbox"]')) return;
                          onRowActivate(row.original, index);
                        }
                      : undefined
                  }
                  className={cn(
                    'focus-visible:outline-ring -outline-offset-2 focus-visible:outline-2',
                    onRowActivate && 'cursor-pointer',
                    getRowClassName?.(row.original),
                  )}
                >
                  {enableRowSelection ? <TableCell>{rowCheckbox(row, index)}</TableCell> : null}
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'max-w-80 truncate',
                        cell.column.columnDef.meta?.align === 'end' && 'text-end',
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          : null}
        {showRows && paddingBottom > 0 ? (
          <tr aria-hidden="true" data-slot="data-table-spacer">
            <td colSpan={visibleColumnCount} style={{ height: paddingBottom, padding: 0 }} />
          </tr>
        ) : null}
      </TableBody>
    </Table>
  );

  return (
    <div
      data-slot="data-table"
      data-layout="table"
      data-status={status}
      data-density={density}
      className={cn('grid gap-3', className)}
    >
      {toolbarNode}
      {statusAlert}
      {loading ? (
        <SkeletonGroup labels={{ loading: text.loading }} className="block">
          {tableNode}
        </SkeletonGroup>
      ) : (
        tableNode
      )}
    </div>
  );
}
