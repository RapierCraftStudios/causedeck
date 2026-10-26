import { EmptyState } from '@causedeck/ui/empty-state';
import type { ReactNode } from 'react';

/** A console page whose content arrives with a later issue. */
export function PlaceholderPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <h1 id="page-title" className="text-lg font-semibold">
        {title}
      </h1>
      {children}
      <EmptyState title="Nothing here yet." description={description} />
    </section>
  );
}
