import { Button } from '../../components/button/button';
import { cn } from '../../lib/cn';

/** One snooze or dismissal on a matter as the surface draws it: text only. */
export interface SnoozeHistoryItem {
  id: string;
  /** The rule's name, or the "all flags" label. */
  ruleLabel: string;
  /** "Snoozed until 2026-11-20" or "Dismissed as intentionally dormant". */
  statusText: string;
  /** "Reason: ..." (absent for a dismissal without one). */
  reasonText?: string;
}

export interface SnoozeHistoryProps {
  title: string;
  empty: string;
  liftLabel: string;
  items: readonly SnoozeHistoryItem[];
  /** Absent for roles that cannot write: no lift control. */
  onLift?: (id: string) => void;
  pending?: boolean;
  className?: string;
}

/** The snoozes and dismissals recorded on a matter (#70), visible on the matter itself. */
export function SnoozeHistory({
  title,
  empty,
  liftLabel,
  items,
  onLift,
  pending = false,
  className,
}: SnoozeHistoryProps) {
  return (
    <section aria-label={title} className={cn('flex flex-col gap-2 font-sans', className)}>
      <h2 className="text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="text-sm">
                <p className="font-medium">{item.ruleLabel}</p>
                <p>{item.statusText}</p>
                {item.reasonText === undefined ? null : (
                  <p className="text-muted-foreground">{item.reasonText}</p>
                )}
              </div>
              {onLift === undefined ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    onLift(item.id);
                  }}
                >
                  {liftLabel}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
