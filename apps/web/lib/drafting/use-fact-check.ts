'use client';
// Live fact-check of unsaved text (#916, part 4 of #170). The hook debounces 600 ms after the last
// edit, then sends only the blocks whose text changed since they were last checked and keeps the
// verdicts of the rest. The rule pass answers first; a second `deep` pass (model-found claims) runs
// after it, never blocks it, and is skipped when the server has no claim finder. A response that
// arrives after the text moved on is dropped. Types only from core: no render library reaches the
// client bundle.
import type { LiveFactVerdict } from '@causedeck/core/drafting';
import type { FactLabels } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type FactResolution = 'open' | 'ignored' | 'asserted';

export interface FactCheckBlock {
  key: string;
  text: string;
}

export interface FactCheckResponse {
  verdicts: LiveFactVerdict[];
  deep: boolean;
}

/** One check call; `null` means the call failed (network or a denied action). */
export type FactCheckRunner = (
  blocks: FactCheckBlock[],
  deep: boolean,
) => Promise<FactCheckResponse | null>;

export const FACT_CHECK_DEBOUNCE_MS = 600;

/** Statuses a lawyer has to look at; a match carries no issue. */
const isIssue = (v: LiveFactVerdict) => v.status !== 'match';

/** Keys of the blocks whose text differs from what was last checked (or that were never checked). */
export function changedBlocks(
  checked: ReadonlyMap<string, { text: string }>,
  blocks: readonly FactCheckBlock[],
): FactCheckBlock[] {
  return blocks.filter((b) => checked.get(b.key)?.text !== b.text);
}

type Entry = { text: string; verdicts: LiveFactVerdict[] };

export interface UseFactCheckOptions {
  /** `null` (no matter) switches the check off. */
  matterId: string | null;
  blocks: readonly FactCheckBlock[];
  run: FactCheckRunner;
  enabled?: boolean;
  debounceMs?: number;
  /** Also ask for model-found claims after the rule pass. */
  deep?: boolean;
}

export interface UseFactCheck {
  /** Verdicts valid for the current text of their block. */
  verdicts: LiveFactVerdict[];
  /** Issues still open (not ignored or asserted). */
  count: number;
  checking: boolean;
  failed: boolean;
  /** Record a decision locally once its action succeeded. */
  resolve: (claimKey: string, resolution: FactResolution) => void;
  recheck: () => void;
}

export function useFactCheck({
  matterId,
  blocks,
  run,
  enabled = true,
  debounceMs = FACT_CHECK_DEBOUNCE_MS,
  deep = false,
}: UseFactCheckOptions): UseFactCheck {
  const cache = useRef(new Map<string, Entry>());
  const latest = useRef(blocks);
  latest.current = blocks;
  const [version, setVersion] = useState(0);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const active = enabled && matterId !== null;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const store = (sent: FactCheckBlock[], verdicts: LiveFactVerdict[]) => {
      const current = new Map(latest.current.map((b) => [b.key, b.text]));
      for (const b of sent) {
        if (current.get(b.key) !== b.text) continue; // the text moved on: drop the answer
        cache.current.set(b.key, {
          text: b.text,
          verdicts: verdicts.filter((v) => v.blockKey === b.key),
        });
      }
      setVersion((n) => n + 1);
    };
    const timer = setTimeout(() => {
      // Drop what belongs to blocks that no longer exist.
      const keys = new Set(blocks.map((b) => b.key));
      for (const k of [...cache.current.keys()]) if (!keys.has(k)) cache.current.delete(k);
      const changed = changedBlocks(cache.current, blocks);
      if (changed.length === 0) return;
      setChecking(true);
      void (async () => {
        const quick = await run(changed, false);
        if (cancelled) return;
        setChecking(false);
        setFailed(quick === null);
        if (quick === null) return;
        store(changed, quick.verdicts);
        if (!deep) return;
        const extra = await run(changed, true); // non-blocking: the rule verdicts are already shown
        if (!cancelled && extra?.deep === true) store(changed, extra.verdicts);
      })();
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [active, blocks, run, debounceMs, deep, nonce]);

  const verdicts = useMemo(() => {
    void version;
    const out: LiveFactVerdict[] = [];
    for (const b of blocks) {
      const hit = cache.current.get(b.key);
      if (hit?.text === b.text) out.push(...hit.verdicts);
    }
    return out;
  }, [blocks, version]);

  const resolve = useCallback((claimKey: string, resolution: FactResolution) => {
    for (const entry of cache.current.values()) {
      entry.verdicts = entry.verdicts.map((v) =>
        v.claimKey === claimKey ? { ...v, resolution } : v,
      );
    }
    setVersion((n) => n + 1);
  }, []);

  const recheck = useCallback(() => {
    cache.current.clear();
    setNonce((n) => n + 1);
  }, []);

  return {
    verdicts: active ? verdicts : [],
    count: active ? verdicts.filter((v) => isIssue(v) && v.resolution === 'open').length : 0,
    checking,
    failed,
    resolve,
    recheck,
  };
}

/** Runner for a surface with one text (a client update, a brief note): that text is block `text`. */
export function singleTextRunner(
  check: (input: {
    workspaceId: string;
    matterId: string;
    blocks: FactCheckBlock[];
    deep: boolean;
  }) => Promise<{ ok: true; data: FactCheckResponse } | { ok: false }>,
  workspaceId: string,
  matterId: string | null,
): FactCheckRunner {
  return async (blocks, deep) => {
    if (matterId === null) return null;
    const result = await check({ workspaceId, matterId, blocks, deep });
    return result.ok ? result.data : null;
  };
}

/** Verdict-card and live-region strings in the active locale (`drafting.factCheck`). */
export function useFactLabels(): FactLabels {
  const t = useTranslations('drafting.factCheck');
  return {
    status: {
      match: t('status.match'),
      mismatch: t('status.mismatch'),
      unsupported: t('status.unsupported'),
      'unverified-citation': t('status.unverifiedCitation'),
      ambiguous: t('status.ambiguous'),
    },
    source: t('source'),
    noSource: t('noSource'),
    fix: t('actions.fix'),
    ignore: t('actions.ignore'),
    ignoreForMatter: t('actions.ignoreForMatter'),
    markAssertion: t('actions.markAssertion'),
    page: (page) => t('page', { page }),
    openPage: (page) => t('openPage', { page }),
    announce: ({ index, total, status }) => t('announce', { index, total, status }),
    noIssues: t('noIssues'),
  };
}

/**
 * Where a Fix can write: the record's own passage replaces the claim only for a case number or a CNR
 * that disagrees with a proceeding of the matter. Everything else is the lawyer's call (PX-6).
 */
export function fixText(v: LiveFactVerdict): string | null {
  const fixable = v.kind === 'case_number' || v.kind === 'cnr';
  return v.status === 'mismatch' && fixable && v.anchor.document.startsWith('proceeding:')
    ? v.anchor.quote
    : null;
}
