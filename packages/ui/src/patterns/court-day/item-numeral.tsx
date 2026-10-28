import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface ItemNumeralProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The cause-list item number as printed (`12`, `12A`); null for an unnumbered item. */
  itemNo: string | null;
  /** Shown for an unnumbered item (translated). */
  unnumberedLabel?: string;
}

/** The large serif item number that anchors a card; an em dash when the list prints none. */
export function ItemNumeral({
  itemNo,
  unnumberedLabel = 'Unnumbered',
  className,
  ...props
}: ItemNumeralProps) {
  return (
    <span
      data-slot="item-numeral"
      className={cn(
        'text-ink inline-flex min-w-11 items-baseline justify-center font-serif text-2xl font-medium tabular-nums',
        className,
      )}
      {...props}
    >
      {itemNo === null ? (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">{unnumberedLabel}</span>
        </>
      ) : (
        itemNo
      )}
    </span>
  );
}
