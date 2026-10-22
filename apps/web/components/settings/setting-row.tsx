// A settings row (#284, #25 design spec): label and description on the left, the control on the
// right; stacked under 768 px. The description's id is `${id}-description`; pass it to the control
// as `aria-describedby`. `note` is an inline line under the description, used for
// `Only workspace owners can change this.`
import { classNames as cn } from './setting-section.tsx';
import type { ReactNode } from 'react';

export interface SettingRowProps {
  /** Base id: the label is `${id}-label`, the description `${id}-description`. */
  id: string;
  label: ReactNode;
  description?: ReactNode;
  note?: ReactNode;
  /** The control (input, select, switch, button). */
  children: ReactNode;
  className?: string;
}

export function settingDescriptionId(id: string): string {
  return `${id}-description`;
}

export function SettingRow({ id, label, description, note, children, className }: SettingRowProps) {
  return (
    <div
      data-slot="setting-row"
      className={cn(
        'flex flex-col gap-3 py-3 md:flex-row md:items-start md:justify-between md:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5 md:max-w-[50%]">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
        {description ? (
          <span id={settingDescriptionId(id)} className="text-ink-muted text-sm">
            {description}
          </span>
        ) : null}
        {note ? (
          <span data-slot="setting-note" className="text-ink-muted text-xs">
            {note}
          </span>
        ) : null}
      </div>
      <div className="flex w-full min-w-0 flex-col md:w-64 md:shrink-0 md:items-end">
        {children}
      </div>
    </div>
  );
}
