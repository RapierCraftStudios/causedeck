// A settings section card (#284, #25 design spec): radius 12, 16 px padding, a sans `lg` 600 title
// and an `--ink-muted` description, then rows separated by hairlines.
import type { ComponentProps, ReactNode } from 'react';

/** Join class names, skipping empty values (shared by the settings components). */
export function classNames(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

const cn = classNames;

export interface SettingSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
}

export function SettingSection({
  title,
  description,
  className,
  children,
  ...props
}: SettingSectionProps) {
  const headingId = props.id === undefined ? undefined : `${props.id}-title`;
  return (
    <section
      data-slot="setting-section"
      aria-labelledby={headingId}
      className={cn('border-line bg-surface flex flex-col rounded-xl border p-4', className)}
      {...props}
    >
      <header className="flex flex-col gap-1 pb-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? <p className="text-ink-muted text-sm">{description}</p> : null}
      </header>
      <div className="divide-line flex flex-col divide-y">{children}</div>
    </section>
  );
}
