import { useRef, type KeyboardEvent } from 'react';

import { Button } from '../../components/button/button';
import { EmptyState } from '../../components/empty-state/empty-state';
import { Skeleton, SkeletonGroup } from '../../components/skeleton';
import { cn } from '../../lib/cn';

/** One stale-matter flag as the surface draws it: text only, nothing here changes data. */
export interface AttentionFlagView {
  key: string;
  matterTitle: string;
  rule: string;
  evidence: string;
  since: string;
  suggestedAction: string;
}

export type AttentionState = 'default' | 'empty' | 'loading' | 'error' | 'offline' | 'denied';

export interface AttentionLabels {
  title: string;
  empty: string;
  loading: string;
  error: string;
  retry: string;
  offline: string;
  denied: string;
  snooze: string;
  openEvidence: string;
  close: string;
  hint: string;
  /** The heading of a rule group, e.g. "No next date". */
  rule: (rule: string, count: number) => string;
  since: (date: string) => string;
}

export const DEFAULT_ATTENTION_LABELS: AttentionLabels = {
  title: 'Needs you',
  empty: 'Nothing needs you right now.',
  loading: 'Loading what needs you',
  error: 'Could not load what needs you. Try again.',
  retry: 'Try again',
  offline: 'You are offline. Showing the last loaded flags.',
  denied: 'You do not have access to these flags in this workspace.',
  snooze: 'Snooze',
  openEvidence: 'Open evidence',
  close: 'Close',
  hint: 'Press s to snooze, Enter to open the evidence, Esc to close.',
  rule: (rule, count) => `${rule} (${String(count)})`,
  since: (date) => `Since ${date}`,
};

export interface AttentionListProps {
  state?: AttentionState;
  flags?: readonly AttentionFlagView[];
  labels?: Partial<AttentionLabels>;
  /** Evidence is shown for the flag with this key. */
  openKey?: string | null;
  onOpen?: (key: string) => void;
  onClose?: () => void;
  onSnooze?: (key: string) => void;
  onRetry?: () => void;
  /** A viewer reads: no snooze. */
  readOnly?: boolean;
  className?: string;
}

/** Flags grouped by rule, in first-seen order. */
export function groupByRule(flags: readonly AttentionFlagView[]): [string, AttentionFlagView[]][] {
  const groups = new Map<string, AttentionFlagView[]>();
  for (const flag of flags) groups.set(flag.rule, [...(groups.get(flag.rule) ?? []), flag]);
  return [...groups.entries()];
}

/**
 * The Needs-you list (#70): flags grouped by rule with their evidence and a suggested action as
 * text. Keyboard: `s` snoozes, `Enter` opens the evidence, `Esc` closes it.
 */
export function AttentionList({
  state = 'default',
  flags = [],
  labels,
  openKey = null,
  onOpen,
  onClose,
  onSnooze,
  onRetry,
  readOnly = false,
  className,
}: AttentionListProps) {
  const l = { ...DEFAULT_ATTENTION_LABELS, ...labels };
  const refs = useRef(new Map<string, HTMLLIElement>());

  if (state === 'loading') {
    return (
      <SkeletonGroup
        labels={{ loading: l.loading }}
        className={cn('flex flex-col gap-3', className)}
      >
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </SkeletonGroup>
    );
  }
  if (state === 'denied') {
    return (
      <EmptyState className={className} role="status" title={l.title} description={l.denied} />
    );
  }
  if (state === 'error') {
    return (
      <EmptyState
        className={className}
        role="alert"
        title={l.title}
        description={l.error}
        action={<Button onClick={onRetry}>{l.retry}</Button>}
      />
    );
  }
  if (state === 'empty' || flags.length === 0) {
    return <EmptyState className={className} role="status" title={l.title} description={l.empty} />;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, key: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') onOpen?.(key);
    else if (event.key === 'Escape') {
      onClose?.();
      refs.current.get(key)?.focus();
    } else if (event.key === 's' && !readOnly) onSnooze?.(key);
  };

  return (
    <section aria-label={l.title} className={cn('flex flex-col gap-4 font-sans', className)}>
      {state === 'offline' ? (
        <p role="status" className="text-muted-foreground text-sm">
          {l.offline}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">{l.hint}</p>
      {groupByRule(flags).map(([rule, items]) => (
        <div key={rule} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{l.rule(rule, items.length)}</h3>
          <ul className="flex flex-col gap-2">
            {items.map((flag) => {
              const open = openKey === flag.key;
              return (
                <li
                  key={flag.key}
                  ref={(node) => {
                    if (node === null) refs.current.delete(flag.key);
                    else refs.current.set(flag.key, node);
                  }}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    onKeyDown(event, flag.key);
                  }}
                  className="rounded-md border p-3 focus-visible:outline-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{flag.matterTitle}</span>
                    <span className="text-muted-foreground text-xs">{l.since(flag.since)}</span>
                  </div>
                  <p className="text-sm">{flag.evidence}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={open}
                      onClick={() => {
                        onOpen?.(flag.key);
                      }}
                    >
                      {l.openEvidence}
                    </Button>
                    {readOnly ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onSnooze?.(flag.key);
                        }}
                      >
                        {l.snooze}
                      </Button>
                    )}
                  </div>
                  {open ? (
                    <div role="group" aria-label={flag.matterTitle} className="mt-2 text-sm">
                      <p>{flag.suggestedAction}</p>
                      <Button variant="ghost" size="sm" onClick={onClose}>
                        {l.close}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
