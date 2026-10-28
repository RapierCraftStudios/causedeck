// The lawyer's text against the prepared text (#736). Added and removed words carry a `+` / `-`
// marker and a screen-reader label as well as colour, so the change is never colour-only.
import { useTranslations } from 'next-intl';

export interface DiffPartView {
  op: 'equal' | 'insert' | 'delete';
  text: string;
}

const words = (text: string) => text.split(/\s+/u).filter((w) => w.length > 0);

/** Word-level diff on whitespace tokens, so a Tamil or Kannada word is never cut. */
export function diffWords(before: string, after: string): DiffPartView[] {
  const a = words(before);
  const b = words(after);
  const lcs = Array.from({ length: a.length + 2 }, () => new Array<number>(b.length + 2).fill(0));
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i];
      if (row) row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const parts: DiffPartView[] = [];
  const push = (op: DiffPartView['op'], text: string) => {
    const last = parts.at(-1);
    if (last?.op === op) last.text += ` ${text}`;
    else parts.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i] ?? '';
    const right = b[j] ?? '';
    if (i < a.length && j < b.length && left === right) {
      push('equal', left);
      i++;
      j++;
    } else if (j < b.length && (i === a.length || at(i, j + 1) >= at(i + 1, j))) {
      push('insert', right);
      j++;
    } else {
      push('delete', left);
      i++;
    }
  }
  return parts;
}

export function DiffView({ parts }: { parts: DiffPartView[] }) {
  const t = useTranslations('outward');
  const changed = parts.some((p) => p.op !== 'equal');
  if (!changed) return <p className="text-ink-muted text-sm">{t('diff.unchanged')}</p>;
  return (
    <p
      role="group"
      aria-label={t('diff.label')}
      data-slot="diff-view"
      className="text-ink font-serif leading-[1.7] break-words whitespace-pre-wrap"
    >
      {parts.map((part, index) =>
        part.op === 'equal' ? (
          <span key={index}>{part.text} </span>
        ) : (
          <span
            key={index}
            data-op={part.op}
            className={
              part.op === 'insert'
                ? 'bg-success-subtle text-success-ink rounded-sm px-0.5'
                : 'bg-danger-subtle text-danger-ink rounded-sm px-0.5 line-through'
            }
          >
            <span className="sr-only">
              {part.op === 'insert' ? t('diff.added') : t('diff.removed')}:{' '}
            </span>
            <span aria-hidden="true">{part.op === 'insert' ? '+' : '-'}</span>
            {part.text}{' '}
          </span>
        ),
      )}
    </p>
  );
}
