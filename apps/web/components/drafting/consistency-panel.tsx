'use client';

// The studio's Consistency panel (#828): the checker's findings grouped by severity, each with what
// the draft says, what the matter graph says and where that came from. `Fix to graph value` is
// confirm-first: a dialog names the replacement, and only `Replace and save` calls `onFix`, which
// saves a new version (the checker never edits on its own). After a fix, `Undo` restores the
// version the fix started from, as another new version.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import type { Finding } from '@causedeck/validators/consistency';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

const SEVERITIES = ['error', 'warn', 'info'] as const;

export interface ConsistencyPanelProps {
  findings: readonly Finding[];
  disabled?: boolean;
  /** True once a check has run, so an empty list reads as "no findings" rather than "not run". */
  checked?: boolean;
  /** Set after a fix: the version number `Undo` goes back to. */
  undoVersionNo?: number | null;
  onJump: (blockKey: string) => void;
  /** Resolves true when the fix was saved as a new version. */
  onFix: (finding: Finding) => Promise<boolean>;
  onUndo: (versionNo: number) => Promise<boolean>;
}

export function ConsistencyPanel({
  findings,
  disabled = false,
  checked = true,
  undoVersionNo = null,
  onJump,
  onFix,
  onUndo,
}: ConsistencyPanelProps) {
  const t = useTranslations('drafting.panels.consistency');
  const tc = useTranslations('drafting.checks.consistency');
  const [pending, setPending] = useState<Finding | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function confirmFix() {
    if (pending === null) return;
    setBusy(true);
    const ok = await onFix(pending);
    setBusy(false);
    setPending(null);
    setMessage(
      ok ? { tone: 'success', text: tc('fixed') } : { tone: 'danger', text: tc('fixFailed') },
    );
  }

  async function undo() {
    if (undoVersionNo === null) return;
    setBusy(true);
    const ok = await onUndo(undoVersionNo);
    setBusy(false);
    setMessage(
      ok ? { tone: 'success', text: tc('undone') } : { tone: 'danger', text: tc('undoFailed') },
    );
  }

  return (
    <section
      data-slot="consistency-panel"
      aria-labelledby="consistency-panel-title"
      className="flex flex-col gap-3"
    >
      <h2 id="consistency-panel-title" className="text-sm font-semibold">
        {t('title')}
      </h2>
      {message === null ? null : (
        <Alert tone={message.tone} role="status">
          {message.text}
        </Alert>
      )}
      {undoVersionNo === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          disabled={disabled || busy}
          onClick={() => void undo()}
        >
          {tc('undo')}
        </Button>
      )}
      {findings.length === 0 ? (
        <p className="text-ink-muted text-sm">{checked ? t('empty') : tc('notRun')}</p>
      ) : null}
      {SEVERITIES.map((severity) => {
        const group = findings.filter((f) => f.severity === severity);
        if (group.length === 0) return null;
        return (
          <div key={severity} data-severity={severity} className="flex flex-col gap-2">
            <h3 className="text-ink-muted text-xs font-semibold uppercase">
              {tc(`severity.${severity}`, { count: group.length })}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.map((finding) => (
                <li
                  key={finding.id}
                  data-finding-id={finding.id}
                  className="border-line flex flex-col gap-1 rounded-md border p-2 text-sm"
                >
                  <span>{tc('found', { found: finding.found })}</span>
                  <span>{tc('expected', { expected: finding.expected })}</span>
                  <span className="text-ink-muted text-xs">
                    {tc('source', { source: finding.provenance.fact })}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="link"
                      onClick={() => {
                        onJump(finding.span.blockKey);
                      }}
                    >
                      {tc('jump')}
                    </Button>
                    {finding.fix === undefined ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={disabled || busy}
                        onClick={() => {
                          setPending(finding);
                        }}
                      >
                        {tc('fix')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent data-slot="fix-dialog">
          <DialogHeader>
            <DialogTitle>{tc('fixTitle')}</DialogTitle>
            <DialogDescription>
              {pending === null
                ? ''
                : tc('fixBody', { found: pending.found, expected: pending.expected })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPending(null);
              }}
            >
              {tc('cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirmFix()}>
              {tc('fixConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
