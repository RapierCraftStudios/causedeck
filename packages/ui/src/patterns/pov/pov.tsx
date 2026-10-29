// Presentational proof-of-value controls (#86): the preparedness tap, the weekly pulse card and the
// context-test panel. State, copy and server calls live in the app; these render every state they
// are given. Targets are 48 px (44 px minimum), `1`-`5` pick a value and `s` skips, and every
// status is a polite live region.
import { useRef, type KeyboardEvent } from 'react';

import { Button } from '../../components/button/button';
import { cn } from '../../lib/cn';

export type PovState = 'default' | 'saving' | 'saved' | 'skipped' | 'error' | 'offline' | 'denied';

const SCALE = [1, 2, 3, 4, 5] as const;

export interface ScaleLabels {
  legend: string;
  option: (value: number) => string;
}

/** A 1-5 radio group: arrow keys move, `1`-`5` pick, a target is at least 48 px square. */
export function RatingScale({
  labels,
  value,
  disabled,
  onSelect,
  onKey,
}: {
  labels: ScaleLabels;
  value: number | null;
  disabled?: boolean;
  onSelect: (value: number) => void;
  /** Keys the scale does not handle itself (`s` to skip, Escape). */
  onKey?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const digit = Number(event.key);
    if (digit >= 1 && digit <= 5 && !disabled) {
      event.preventDefault();
      onSelect(digit);
      refs.current[digit - 1]?.focus();
      return;
    }
    const at = refs.current.findIndex((el) => el === document.activeElement);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      refs.current[Math.min(4, at + 1)]?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      refs.current[Math.max(0, at - 1)]?.focus();
    } else onKey?.(event);
  };
  return (
    <div
      role="radiogroup"
      aria-label={labels.legend}
      className="flex flex-wrap gap-2"
      onKeyDown={onKeyDown}
    >
      {SCALE.map((n, i) => (
        <button
          key={n}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={labels.option(n)}
          tabIndex={value === n || (value === null && n === 1) ? 0 : -1}
          disabled={disabled}
          onClick={() => {
            onSelect(n);
          }}
          className={cn(
            'border-line focus-visible:ring-ring min-h-12 min-w-12 rounded-md border text-base font-medium focus-visible:ring-2 focus-visible:outline-none',
            value === n ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground',
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export interface TapLabels extends ScaleLabels {
  title: string;
  hint: string;
  skip: string;
  retry: string;
  messages: Partial<Record<PovState, string>>;
}

/** The preparedness tap: pick 1-5 or skip; saved, skipped, error with retry, offline, denied. */
export function PreparednessTapView({
  labels,
  state,
  value,
  onRate,
  onSkip,
  onRetry,
}: {
  labels: TapLabels;
  state: PovState;
  value: number | null;
  onRate: (value: number) => void;
  onSkip: () => void;
  onRetry: () => void;
}) {
  const message = labels.messages[state];
  return (
    <section aria-label={labels.title} className="grid gap-2 rounded-md border p-3">
      <h2 className="text-sm font-medium">{labels.title}</h2>
      {state === 'denied' ? null : (
        <>
          <p className="text-muted-foreground text-sm">{labels.hint}</p>
          <RatingScale
            labels={labels}
            value={value}
            disabled={state === 'saving'}
            onSelect={onRate}
            onKey={(event) => {
              if (event.key.toLowerCase() === 's') onSkip();
            }}
          />
          <Button variant="ghost" className="min-h-12 w-fit" onClick={onSkip}>
            {labels.skip}
          </Button>
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm">
        {message ?? ''}
      </p>
      {state === 'error' ? (
        <Button variant="outline" className="min-h-12 w-fit" onClick={onRetry}>
          {labels.retry}
        </Button>
      ) : null}
    </section>
  );
}

export interface PulseItem {
  id: string;
  label: string;
}
export interface PulseLabels {
  title: string;
  intro: string;
  low: string;
  high: string;
  option: (value: number) => string;
  submit: string;
  dismiss: string;
  retry: string;
  messages: Partial<Record<PovState | 'dismissed', string>>;
}

/** The weekly pulse card: three 1-5 items, Save, and Not now (Escape too). */
export function PulseCardView({
  labels,
  items,
  values,
  state,
  onChange,
  onSubmit,
  onDismiss,
  onRetry,
}: {
  labels: PulseLabels;
  items: readonly PulseItem[];
  values: Readonly<Record<string, number>>;
  state: PovState | 'dismissed';
  onChange: (id: string, value: number) => void;
  onSubmit: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const complete = items.every((item) => values[item.id] !== undefined);
  const closed = state === 'saved' || state === 'dismissed' || state === 'denied';
  return (
    <section
      aria-label={labels.title}
      className="grid gap-3 rounded-md border p-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      <h2 className="text-sm font-medium">{labels.title}</h2>
      {closed ? null : (
        <>
          <p className="text-muted-foreground text-sm">{labels.intro}</p>
          {items.map((item) => (
            <div key={item.id} className="grid gap-1">
              <p className="text-sm">{item.label}</p>
              <RatingScale
                labels={{ legend: item.label, option: labels.option }}
                value={values[item.id] ?? null}
                disabled={state === 'saving'}
                onSelect={(v) => {
                  onChange(item.id, v);
                }}
              />
              <p className="text-muted-foreground flex justify-between text-xs" aria-hidden>
                <span>{labels.low}</span>
                <span>{labels.high}</span>
              </p>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-12"
              disabled={!complete || state === 'saving'}
              onClick={onSubmit}
            >
              {labels.submit}
            </Button>
            <Button variant="ghost" className="min-h-12" onClick={onDismiss}>
              {labels.dismiss}
            </Button>
          </div>
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm">
        {labels.messages[state] ?? ''}
      </p>
      {state === 'error' ? (
        <Button variant="outline" className="min-h-12 w-fit" onClick={onRetry}>
          {labels.retry}
        </Button>
      ) : null}
    </section>
  );
}

export type ContextTestPhase = 'ready' | 'running' | 'finished' | 'error' | 'offline' | 'denied';

export interface ContextTestLabels {
  title: string;
  intro: string;
  start: string;
  finish: string;
  again: string;
  retry: string;
  correct: string;
  wrong: string;
  elapsed: string;
  empty: string;
  messages: Partial<Record<ContextTestPhase, string>>;
}

export interface ContextQuestion {
  id: string;
  label: string;
  mark: boolean | null;
}

/** The context test panel: ready, running (stopwatch, five questions to mark), finished. */
export function ContextTestView({
  labels,
  phase,
  questions,
  elapsed,
  matterPicker,
  onStart,
  onMark,
  onFinish,
  onAgain,
  onRetry,
}: {
  labels: ContextTestLabels;
  phase: ContextTestPhase;
  questions: readonly ContextQuestion[];
  /** The visible stopwatch text; not a live region, so it does not chatter. */
  elapsed: string;
  matterPicker: React.ReactNode;
  onStart: () => void;
  onMark: (id: string, correct: boolean) => void;
  onFinish: () => void;
  onAgain: () => void;
  onRetry: () => void;
}) {
  const allMarked = questions.every((q) => q.mark !== null);
  return (
    <section aria-label={labels.title} className="grid gap-3 rounded-md border p-3">
      <h2 className="text-sm font-medium">{labels.title}</h2>
      {phase === 'denied' ? null : phase === 'ready' || phase === 'error' || phase === 'offline' ? (
        <>
          <p className="text-muted-foreground text-sm">{labels.intro}</p>
          {matterPicker}
          <Button className="min-h-12 w-fit" disabled={phase === 'offline'} onClick={onStart}>
            {labels.start}
          </Button>
        </>
      ) : (
        <>
          <p className="font-mono text-lg" aria-label={labels.elapsed}>
            {elapsed}
          </p>
          <ol className="grid gap-2">
            {questions.map((q) => (
              <li key={q.id} className="grid gap-1">
                <span className="text-sm">{q.label}</span>
                {phase === 'running' ? (
                  <span className="flex gap-2" role="group" aria-label={q.label}>
                    <Button
                      variant={q.mark === true ? 'primary' : 'outline'}
                      aria-pressed={q.mark === true}
                      className="min-h-12"
                      onClick={() => {
                        onMark(q.id, true);
                      }}
                    >
                      {labels.correct}
                    </Button>
                    <Button
                      variant={q.mark === false ? 'primary' : 'outline'}
                      aria-pressed={q.mark === false}
                      className="min-h-12"
                      onClick={() => {
                        onMark(q.id, false);
                      }}
                    >
                      {labels.wrong}
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {phase === 'running' ? (
            <Button className="min-h-12 w-fit" disabled={!allMarked} onClick={onFinish}>
              {labels.finish}
            </Button>
          ) : (
            <Button variant="outline" className="min-h-12 w-fit" onClick={onAgain}>
              {labels.again}
            </Button>
          )}
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm">
        {labels.messages[phase] ?? ''}
      </p>
      {phase === 'error' ? (
        <Button variant="outline" className="min-h-12 w-fit" onClick={onRetry}>
          {labels.retry}
        </Button>
      ) : null}
    </section>
  );
}
