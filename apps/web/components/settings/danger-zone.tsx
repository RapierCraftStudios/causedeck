// The danger zone card (#284, #25 design spec): set apart with extra spacing and a `--danger-soft`
// border tint. Its rows are destructive entry points (transfer ownership, delete workspace).
import { classNames as cn } from './setting-section.tsx';
import type { ComponentProps, ReactNode } from 'react';

export interface DangerZoneProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
}

export function DangerZone({ title, description, className, children, ...props }: DangerZoneProps) {
  return (
    <section
      data-slot="danger-zone"
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn(
        'border-danger-soft bg-surface mt-6 flex flex-col rounded-xl border-2 p-4',
        className,
      )}
      {...props}
    >
      <header className="flex flex-col gap-1 pb-2">
        <h2 className="text-danger text-lg font-semibold">{title}</h2>
        {description ? <p className="text-ink-muted text-sm">{description}</p> : null}
      </header>
      <div className="divide-line flex flex-col divide-y">{children}</div>
    </section>
  );
}
