import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface HandoverItem {
  id: string;
  text: string;
  /** Provenance or date detail shown under the text, e.g. `p. 2 · order of 16 Oct`. */
  detail?: string | undefined;
  /** A short flag such as `Unconfirmed` or `Overdue`. */
  flag?: string | undefined;
}

export interface HandoverSectionView {
  id: string;
  title: string;
  items: readonly HandoverItem[];
  /** Shown when there are no items, e.g. `None recorded`. */
  emptyLabel: string;
}

export interface HandoverViewProps extends Omit<ComponentProps<'article'>, 'children' | 'title'> {
  title: string;
  /** Who wrote it, for whom and when, e.g. `Version 2 · from Asha to Vikram · 26 Oct`. */
  byline?: string | undefined;
  sections: readonly HandoverSectionView[];
  /** Left out when the note is not addressed to the viewer. */
  acknowledge?:
    { label: string; doneLabel: string; done: boolean; onAcknowledge: () => void } | undefined;
  footer?: ReactNode;
}

/** The handover note: one stack of short sections, the five standard questions first. Internal only: no share or export control. */
export function HandoverView({
  title,
  byline,
  sections,
  acknowledge,
  footer,
  className,
  ...props
}: HandoverViewProps) {
  return (
    <article
      data-slot="handover-view"
      className={cn('border-line grid max-w-prose gap-4 rounded-md border p-4', className)}
      {...props}
    >
      <header className="grid gap-1">
        <h2 className="font-serif text-lg">{title}</h2>
        {byline === undefined ? null : <p className="text-muted-foreground text-sm">{byline}</p>}
      </header>
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`handover-${section.id}`} className="grid gap-1">
          <h3 id={`handover-${section.id}`} className="text-sm font-medium">
            {section.title}
          </h3>
          {section.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{section.emptyLabel}</p>
          ) : (
            <ul className="grid list-none gap-1 p-0">
              {section.items.map((item) => (
                <li key={item.id} className="text-sm break-words">
                  <span>{item.text}</span>
                  {item.flag === undefined ? null : (
                    <span className="bg-muted ml-2 rounded px-1 text-xs">{item.flag}</span>
                  )}
                  {item.detail === undefined ? null : (
                    <span className="text-muted-foreground block text-xs">{item.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {acknowledge === undefined ? null : acknowledge.done ? (
        <p role="status" className="text-sm">
          {acknowledge.doneLabel}
        </p>
      ) : (
        <button
          type="button"
          onClick={acknowledge.onAcknowledge}
          className="border-line focus-visible:ring-ring min-h-11 w-fit rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {acknowledge.label}
        </button>
      )}
      {footer}
    </article>
  );
}

/** The loading shape of the handover note. */
export function HandoverSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="grid max-w-prose gap-3 p-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-muted h-4 animate-pulse rounded"
          style={{ width: `${String(90 - i * 15)}%` }}
        />
      ))}
    </div>
  );
}
