import { TriangleAlert } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface ClashBracketProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Heading, e.g. `Clash`. */
  title: string;
  /** The factual statement (no predicted time). */
  statement: string;
}

/** A clash card: an icon and text, never colour alone. It states a fact and predicts nothing. */
export function ClashBracket({ title, statement, className, ...props }: ClashBracketProps) {
  return (
    <div
      data-slot="clash-bracket"
      role="note"
      className={cn(
        'border-warning/50 bg-warning-soft text-ink flex items-start gap-2 rounded-md border-s-4 px-3 py-2 text-sm',
        className,
      )}
      {...props}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium">{title}</span> {statement}
      </p>
    </div>
  );
}
