'use client';

import { Check, Pencil, X } from 'lucide-react';
import { useId, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '../../components/button';
import { isTypingTarget } from '../../hooks/use-hotkey';
import { cn } from '../../lib/cn';

export interface TrayProposal {
  id: string;
  /** What would be remembered: `Brief format`. */
  title: string;
  /** The statement in plain language, e.g. "You usually carry the vakalat copy. Remember this?" */
  statement: string;
  /** Why it is proposed, already in plain language (counts, never quoted content). */
  evidence: string;
  /** A `ScopeChip` for where it would be saved. */
  scopeChip?: ReactNode;
}

export interface ProposalTrayLabels {
  heading: (count: number) => string;
  save: string;
  edit: string;
  dismiss: string;
  shortcuts: string;
  offline: string;
  viewOnly: string;
  action: (action: string, title: string) => string;
}

export const DEFAULT_PROPOSAL_TRAY_LABELS: ProposalTrayLabels = {
  heading: (count) => (count === 1 ? '1 suggestion' : `${String(count)} suggestions`),
  save: 'Save',
  edit: 'Edit',
  dismiss: 'Dismiss',
  shortcuts: 'S saves, E edits, X dismisses the focused suggestion.',
  offline: 'You are offline. Suggestions can be decided when you are back online.',
  viewOnly: 'View only',
  action: (action, title) => `${action}: ${title}`,
};

export interface ProposalTrayProps extends Omit<ComponentProps<'section'>, 'children'> {
  proposals: readonly TrayProposal[];
  onSave?: ((id: string) => void) | undefined;
  onEdit?: ((id: string) => void) | undefined;
  onDismiss?: ((id: string) => void) | undefined;
  offline?: boolean | undefined;
  viewOnly?: boolean | undefined;
  /** Disable every action while a parent saves. */
  disabled?: boolean | undefined;
  labels?: Partial<ProposalTrayLabels> | undefined;
}

const KEYS = { s: 'save', e: 'edit', x: 'dismiss' } as const;

/**
 * Pending "Save this?" proposals. Nothing becomes memory until Save is pressed; `s`, `e` and `x`
 * act on the focused proposal (the shortcut is bound to the tray, not the document).
 */
export function ProposalTray({
  proposals,
  onSave,
  onEdit,
  onDismiss,
  offline = false,
  viewOnly = false,
  disabled = false,
  labels,
  className,
  ...props
}: ProposalTrayProps) {
  const text = { ...DEFAULT_PROPOSAL_TRAY_LABELS, ...labels };
  const headingId = useId();
  const hintId = useId();
  const locked = offline || disabled;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (isTypingTarget(event.target)) return;
    const action = KEYS[event.key.toLowerCase() as keyof typeof KEYS];
    const card = (event.target as Element).closest<HTMLElement>('[data-proposal-id]');
    if (action === undefined || card === null || locked || viewOnly) return;
    const id = card.dataset.proposalId ?? '';
    event.preventDefault();
    if (action === 'save') onSave?.(id);
    else if (action === 'edit') onEdit?.(id);
    else onDismiss?.(id);
  };

  if (proposals.length === 0) return null;
  return (
    <section
      data-slot="proposal-tray"
      aria-labelledby={headingId}
      aria-describedby={viewOnly ? undefined : hintId}
      className={cn(
        'border-line bg-surface-raised sticky top-0 z-10 flex flex-col gap-3 rounded-xl border p-4',
        'font-sans xl:static',
        className,
      )}
      onKeyDown={onKeyDown}
      {...props}
    >
      <h2 id={headingId} className="text-ink text-sm font-semibold">
        {text.heading(proposals.length)}
      </h2>
      {viewOnly ? (
        <p className="text-ink-subtle text-xs">{text.viewOnly}</p>
      ) : (
        <p id={hintId} className="text-ink-muted text-xs">
          {offline ? text.offline : text.shortcuts}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {proposals.map((p) => (
          <li
            key={p.id}
            data-proposal-id={p.id}
            tabIndex={0}
            aria-label={p.title}
            className="border-line focus-visible:ring-focus-ring flex flex-col gap-2 rounded-lg border p-3 outline-none focus-visible:ring-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              {p.scopeChip}
              <span className="text-ink text-sm font-medium">{p.title}</span>
            </div>
            <p className="text-ink font-serif text-base">{p.statement}</p>
            <p data-slot="proposal-evidence" className="text-ink-muted text-xs">
              {p.evidence}
            </p>
            {viewOnly ? null : (
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  disabled={locked}
                  aria-keyshortcuts="S"
                  aria-label={text.action(text.save, p.title)}
                  onClick={() => onSave?.(p.id)}
                >
                  <Check aria-hidden="true" />
                  {text.save}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  aria-keyshortcuts="E"
                  aria-label={text.action(text.edit, p.title)}
                  onClick={() => onEdit?.(p.id)}
                >
                  <Pencil aria-hidden="true" />
                  {text.edit}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  aria-keyshortcuts="X"
                  aria-label={text.action(text.dismiss, p.title)}
                  onClick={() => onDismiss?.(p.id)}
                >
                  <X aria-hidden="true" />
                  {text.dismiss}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
