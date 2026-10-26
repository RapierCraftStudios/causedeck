// "Undo available for 6 more days" (#49): static text, not a live timer, so a screen reader is not
// interrupted every second. The window is the engine's `undoExpiresAt` (7 days from the action).
import { useTranslations } from 'next-intl';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left, rounded up; 0 when less than a day or none is left. */
export function undoDaysLeft(undoExpiresAt: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(undoExpiresAt) - now.getTime()) / DAY_MS));
}

export function UndoCountdown({ undoExpiresAt, now }: { undoExpiresAt: string; now: Date }) {
  const t = useTranslations('activity.item');
  const remaining = Date.parse(undoExpiresAt) - now.getTime();
  const days = Math.floor(remaining / DAY_MS);
  return (
    <span data-slot="undo-countdown" className="text-ink-muted text-xs">
      {days < 1 ? t('undoLessThanDay') : t('undoAvailable', { days })}
    </span>
  );
}
