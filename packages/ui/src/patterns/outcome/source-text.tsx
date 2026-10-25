import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface SourceSpan {
  start: number;
  end: number;
}

export interface SourceTextProps extends Omit<ComponentProps<'div'>, 'children'> {
  text: string;
  /** Character ranges that sources point at; highlighted, never rewritten. */
  spans?: readonly SourceSpan[] | undefined;
  /** BCP 47 tag of the original text; shown as given, with no translation. */
  language: string;
  languageLabel: string;
}

/** The original text with the cited spans marked, in its own language. */
export function SourceText({
  text,
  spans = [],
  language,
  languageLabel,
  className,
  ...props
}: SourceTextProps) {
  const ordered = [...spans]
    .filter((s) => s.start >= 0 && s.end > s.start && s.end <= text.length)
    .sort((a, b) => a.start - b.start);
  const parts: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const span of ordered) {
    if (span.start < at) continue;
    if (span.start > at) parts.push({ text: text.slice(at, span.start), mark: false });
    parts.push({ text: text.slice(span.start, span.end), mark: true });
    at = span.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), mark: false });
  return (
    <div data-slot="source-text" className={cn('grid gap-2', className)} {...props}>
      <p className="text-muted-foreground text-xs">{languageLabel}</p>
      <p lang={language} className="text-sm leading-relaxed whitespace-pre-wrap">
        {parts.map((part, index) =>
          part.mark ? (
            <mark key={index} className="bg-accent text-accent-foreground rounded px-0.5">
              {part.text}
            </mark>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
    </div>
  );
}
