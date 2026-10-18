import { WifiOff } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface OfflineBannerLabels {
  /** The full sentence around the formatted time. */
  message: (time: string) => string;
}

export const DEFAULT_OFFLINE_BANNER_LABELS: OfflineBannerLabels = {
  message: (time) => `You are offline. Showing saved data from ${time}.`,
};

export interface OfflineBannerProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** When the data on screen was last saved. */
  savedAt: Date;
  /** Formats `savedAt`; defaults to a short time in `timeZone`. */
  formatTime?: ((savedAt: Date) => string) | undefined;
  locale?: string | undefined;
  timeZone?: string | undefined;
  labels?: Partial<OfflineBannerLabels> | undefined;
}

/** Short time of day, e.g. `10:42 am`, in the lawyer's zone. */
export function formatSavedTime(savedAt: Date, locale = 'en-IN', timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(savedAt);
}

/** Read-only notice above a surface while offline. Actions below stay disabled with a reason. */
export function OfflineBanner({
  savedAt,
  formatTime,
  locale,
  timeZone,
  labels,
  className,
  ...props
}: OfflineBannerProps) {
  const text = { ...DEFAULT_OFFLINE_BANNER_LABELS, ...labels };
  const time = formatTime ? formatTime(savedAt) : formatSavedTime(savedAt, locale, timeZone);
  return (
    <div
      role="status"
      data-slot="offline-banner"
      data-pattern-state="offline"
      className={cn(
        'border-line bg-surface-sunken text-ink flex items-start gap-2 rounded-lg border px-3 py-2',
        'font-sans text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <WifiOff aria-hidden="true" className="text-ink-muted" />
      <p className="min-w-0 wrap-break-word">
        <time dateTime={savedAt.toISOString()}>{text.message(time)}</time>
      </p>
    </div>
  );
}
