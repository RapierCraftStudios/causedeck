'use client';

// Drafting studio shell (#827). Three columns from 1280 px (facts, editor, versions), one slide-in
// drawer at 768 px, and a bottom sheet with tabs at 360 px; panels move without animation under
// `prefers-reduced-motion`. The editor is a lazy chunk (the route's initial JS stays small).
// Save is Cmd/Ctrl+S, draft actions Cmd/Ctrl+K, `]` and `[` walk the findings (announced in a live
// region), Esc closes what is open. Offline, the loaded draft stays readable from the encrypted
// device cache and edits queue until `online`. `panels` is where #828's citation and consistency
// panels go.
import type { LiveFactVerdict } from '@causedeck/core/drafting';
import { useFactNavigation } from '@causedeck/ui/patterns';
import type { Finding } from '@causedeck/validators/consistency';
import type { Block, ExportFormat } from '@causedeck/validators/drafting';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { CitationView } from '../../../../../../components/drafting/citation-panel.tsx';
import type { ExportLink } from '../../../../../../components/drafting/export-dialog.tsx';
import type { PinnedAuthority } from '../../../../../../components/drafting/authorities-panel.tsx';
import type { DraftFact } from '../../../../../../components/drafting/facts-panel.tsx';
import type { DraftVersionView } from '../../../../../../components/drafting/version-drawer.tsx';
import { registerCommands } from '../../../../../../lib/commands/registry.ts';
import {
  editBlockText,
  hasMissing,
  insertFact,
  keyedBlocks,
  stepFinding,
  type EditDiff,
} from '../../../../../../lib/drafting/blocks-edit.ts';
import {
  browserDraftEditStores,
  cacheDraft,
  flushDraftEdits,
  pendingDraftEdits,
  queueDraftEdit,
  readCachedDraft,
  type QueuedDraftEdit,
} from '../../../../../../lib/pwa/outbox/draft-edits.ts';
import {
  fixText,
  useFactCheck,
  useFactLabels,
  type FactCheckRunner,
} from '../../../../../../lib/drafting/use-fact-check.ts';
import { DRAFT_STUDIO_SHORTCUTS } from '../../../../../../lib/shortcuts/registry.ts';

import type { restoreDraftVersionAction, saveDraftAction } from './actions.ts';
import type {
  checkFactsLiveAction,
  ignoreFactAction,
  markAssertionAction,
} from './factcheck-actions.ts';
import type {
  acknowledgeUnverifiedAction,
  applyFixAction,
  downloadDraftExportAction,
  exportDraftAction,
  runChecksAction,
} from './checks-actions.ts';

// Heavy parts load on demand so the route's initial JS stays under its 40 KB budget: the editor,
// the facts panel (Provenance Chips pull in popover/tooltip code) and the version drawer (diff).
const panelLoading = () => <div aria-hidden="true" className="bg-surface-sunken h-40 rounded-md" />;
const FactsPanel = dynamic(
  () => import('../../../../../../components/drafting/facts-panel.tsx').then((m) => m.FactsPanel),
  { ssr: false, loading: panelLoading },
);
const FactCheckPanel = dynamic(
  () =>
    import('../../../../../../components/drafting/fact-check-panel.tsx').then(
      (m) => m.FactCheckPanel,
    ),
  { ssr: false, loading: panelLoading },
);
const AuthoritiesPanel = dynamic(
  () =>
    import('../../../../../../components/drafting/authorities-panel.tsx').then(
      (m) => m.AuthoritiesPanel,
    ),
  { ssr: false, loading: panelLoading },
);
const VersionDrawer = dynamic(
  () =>
    import('../../../../../../components/drafting/version-drawer.tsx').then((m) => m.VersionDrawer),
  { ssr: false, loading: panelLoading },
);
// #828: the checks panels and dialogs load on demand too.
const CitationPanel = dynamic(
  () =>
    import('../../../../../../components/drafting/citation-panel.tsx').then((m) => m.CitationPanel),
  { ssr: false, loading: panelLoading },
);
const ConsistencyPanel = dynamic(
  () =>
    import('../../../../../../components/drafting/consistency-panel.tsx').then(
      (m) => m.ConsistencyPanel,
    ),
  { ssr: false, loading: panelLoading },
);
const AckDialog = dynamic(
  () => import('../../../../../../components/drafting/ack-dialog.tsx').then((m) => m.AckDialog),
  { ssr: false, loading: panelLoading },
);
const DraftExportDialog = dynamic(
  () =>
    import('../../../../../../components/drafting/export-dialog.tsx').then(
      (m) => m.DraftExportDialog,
    ),
  { ssr: false, loading: panelLoading },
);
const DraftEditor = dynamic(() => import('../../../../../../components/drafting/editor.tsx'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="bg-surface-sunken h-64 rounded-md" />,
});

export interface StudioProps {
  /**
   * The server actions, bound by page.tsx. Passed in (not imported) so the studio stays free of
   * server-only code and Storybook can render it with stand-ins.
   */
  actions: {
    save: typeof saveDraftAction;
    restore: typeof restoreDraftVersionAction;
  };
  workspaceId: string;
  draftId: string;
  title: string;
  versionNo: number;
  blocks: Block[];
  slotValues: Record<string, string>;
  /** Model-written text by narrative block key; shown with the AI-drafted marker until edited. */
  aiTexts?: Record<string, string>;
  facts: DraftFact[];
  /** Authorities pinned on the matter's research notes (#782). */
  authorities?: PinnedAuthority[];
  versions: DraftVersionView[];
  /** Extra places `]` and `[` can go (#828's findings), by block key. */
  findingKeys?: string[];
  /** #828's citation and consistency panels. */
  panels?: ReactNode;
  /** #828: the checks of the version being edited, with the actions that run, fix and export. */
  checks?: StudioChecks;
  /** #916: the live fact-check; absent, or without a matter, the studio checks nothing. */
  factCheck?: StudioFactCheck;
}

export interface StudioFactCheck {
  /** The matter whose record the draft is checked against. */
  matterId: string | null;
  actions: {
    check: typeof checkFactsLiveAction;
    ignore: typeof ignoreFactAction;
    assert: typeof markAssertionAction;
  };
}

export interface StudioChecks {
  actions: {
    run: typeof runChecksAction;
    acknowledge: typeof acknowledgeUnverifiedAction;
    fix: typeof applyFixAction;
    exportDraft: typeof exportDraftAction;
    download: typeof downloadDraftExportAction;
  };
  /** The id of the version `versionNo` names (what the checks and the export read). */
  versionId: string;
  citations: CitationView[];
  findings: Finding[];
  /** A consistency report exists for this version. */
  checked: boolean;
  courtPreset: string | null;
  aiAssisted: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'queued' | 'conflict' | 'failed';
type Panel = 'facts' | 'versions';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

export function DraftStudio(props: StudioProps) {
  const t = useTranslations('drafting');
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(props.blocks);
  const [baseNo, setBaseNo] = useState(props.versionNo);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<SaveState>('idle');
  const [online, setOnline] = useState(true);
  const [cached, setCached] = useState(false);
  const [pending, setPending] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | undefined>();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [menu, setMenu] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [dialog, setDialog] = useState<'ack' | 'export' | null>(null);
  const [undoNo, setUndoNo] = useState<number | null>(null);
  const [live, setLive] = useState<{ citations: CitationView[]; findings: Finding[] } | null>(null);
  const [finding, setFinding] = useState(-1);
  const [announcement, setAnnouncement] = useState('');
  const [fixUndo, setFixUndo] = useState<Block[] | null>(null);
  const diffs = useRef<EditDiff[]>([]);
  const editorRef = useRef<HTMLElement | null>(null);
  const factLabels = useFactLabels();
  const factCheck = props.factCheck;

  const readOnly = !online && cached;

  // Live fact-check of the text as it stands (#916): headings and paragraphs, as the editor shows them.
  const checkBlocks = useMemo(
    () =>
      keyedBlocks(blocks).flatMap(({ block, key }) =>
        block.type === 'heading' || block.type === 'paragraph' ? [{ key, text: block.text }] : [],
      ),
    [blocks],
  );
  const runFacts = useCallback<FactCheckRunner>(
    async (sent, deep) => {
      if (factCheck?.matterId == null) return null;
      const result = await factCheck.actions.check({
        workspaceId: props.workspaceId,
        matterId: factCheck.matterId,
        blocks: sent,
        deep,
      });
      return result.ok ? result.data : null;
    },
    [factCheck, props.workspaceId],
  );
  const facts = useFactCheck({
    matterId: factCheck?.matterId ?? null,
    blocks: checkBlocks,
    run: runFacts,
    enabled: !readOnly && online,
    deep: true,
  });
  const factAnnouncement = useFactNavigation(editorRef, factLabels);
  const blockTexts = useMemo(
    () => Object.fromEntries(checkBlocks.map((b) => [b.key, b.text])),
    [checkBlocks],
  );

  /** Click-only: the record's own passage replaces the claim; one step back restores the text. */
  const applyFactFix = (v: LiveFactVerdict) => {
    const text = blockTexts[v.blockKey];
    const fix = fixText(v);
    if (text === undefined || fix === null) return;
    setFixUndo(blocks);
    setBlocks(
      editBlockText(blocks, v.blockKey, text.slice(0, v.start) + fix + text.slice(v.end)).blocks,
    );
    setDirty(true);
  };
  const decideFact = async (v: LiveFactVerdict, kind: 'ignored' | 'asserted') => {
    const draftVersionId = checks?.versionId;
    if (factCheck === undefined || draftVersionId === undefined) return;
    const input = { workspaceId: props.workspaceId, draftVersionId, claimKey: v.claimKey };
    const result = await (kind === 'ignored'
      ? factCheck.actions.ignore(input)
      : factCheck.actions.assert(input));
    if (result.ok) facts.resolve(v.claimKey, kind);
  };
  const jumpToFact = (v: LiveFactVerdict) => {
    setPanel(null);
    const field = document.querySelector<HTMLTextAreaElement>(
      `[data-block-key="${CSS.escape(v.blockKey)}"]`,
    );
    field?.focus();
    field?.setSelectionRange(v.start, v.end);
    field?.scrollIntoView({ block: 'center' });
  };

  // A fresh server version (after a restore or reload) replaces the local tree.
  /* eslint-disable react-hooks/set-state-in-effect -- adopting a new server version is the point of this effect */
  useEffect(() => {
    setBlocks(props.blocks);
    setBaseNo(props.versionNo);
    setDirty(false);
    diffs.current = [];
  }, [props.blocks, props.versionNo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const findings = useMemo(() => {
    const keys = keyedBlocks(blocks)
      .filter(({ block, key }) =>
        block.type === 'paragraph'
          ? hasMissing(block.text)
          : block.type === 'slot' && hasMissing(props.slotValues[key] ?? ''),
      )
      .map((entry) => entry.key);
    return [...new Set([...keys, ...(props.findingKeys ?? [])])];
  }, [blocks, props.slotValues, props.findingKeys]);

  const refreshPending = useCallback(async () => {
    const { store } = await browserDraftEditStores();
    setPending(await pendingDraftEdits(store, props.workspaceId));
  }, [props.workspaceId]);

  const { workspaceId, draftId, title, versionNo, blocks: initial } = props;
  // Cache the loaded draft for offline reading; track connectivity and flush the queue on `online`.
  useEffect(() => {
    void (async () => {
      const { store, keys } = await browserDraftEditStores();
      await cacheDraft(store, keys, { workspaceId, draftId, title, versionNo, blocks: initial });
      setCached((await readCachedDraft(store, keys, workspaceId, draftId)) !== undefined);
      await refreshPending();
    })().catch(() => undefined);
  }, [workspaceId, draftId, title, versionNo, initial, refreshPending]);

  const saveAction = props.actions.save;
  const send = useCallback(
    async (edit: QueuedDraftEdit) => {
      const result = await saveAction({
        workspaceId: edit.workspaceId,
        draftId: edit.draftId,
        baseVersionNo: edit.baseVersionNo,
        blocks: edit.blocks,
      });
      return result.ok
        ? ({ ok: true } as const)
        : ({ ok: false, code: result.error.code } as const);
    },
    [saveAction],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser's connectivity once on mount
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      void (async () => {
        const { store, keys } = await browserDraftEditStores();
        const result = await flushDraftEdits(store, keys, send);
        await refreshPending();
        if (result.conflicts > 0) setState('conflict');
        else if (result.sent > 0) {
          setState('saved');
          setAnnouncement(t('offline.synced'));
          router.refresh();
        }
      })().catch(() => undefined);
    };
    const goOffline = () => {
      setOnline(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [send, refreshPending, router, t]);

  const save = useCallback(async () => {
    if (readOnly && !dirty) return;
    const edit: QueuedDraftEdit = {
      workspaceId: props.workspaceId,
      draftId: props.draftId,
      baseVersionNo: baseNo,
      blocks,
      diffs: diffs.current,
    };
    const queue = async () => {
      const { store, keys } = await browserDraftEditStores();
      await queueDraftEdit(store, keys, edit);
      diffs.current = [];
      setState('queued');
      await refreshPending();
    };
    if (!navigator.onLine) return queue();
    setState('saving');
    try {
      const result = await saveAction({
        workspaceId: edit.workspaceId,
        draftId: edit.draftId,
        baseVersionNo: edit.baseVersionNo,
        blocks: edit.blocks,
      });
      if (result.ok) {
        setBaseNo(result.data.versionNo);
        setDirty(false);
        diffs.current = [];
        setState('saved');
        setAnnouncement(t('states.saved'));
        router.refresh();
      } else {
        setState(result.error.code === 'CONFLICT' ? 'conflict' : 'failed');
      }
    } catch {
      await queue().catch(() => {
        setState('failed');
      });
    }
  }, [
    readOnly,
    dirty,
    props.workspaceId,
    props.draftId,
    saveAction,
    baseNo,
    blocks,
    refreshPending,
    router,
    t,
  ]);

  async function restore(versionNo: number) {
    const result = await props.actions.restore({
      workspaceId: props.workspaceId,
      draftId: props.draftId,
      versionNo,
    });
    if (result.ok) {
      setAnnouncement(t('panels.versions.restored'));
      router.refresh();
    } else {
      setState('failed');
    }
  }

  const checks = props.checks;
  const citations = live?.citations ?? checks?.citations ?? [];
  const checkFindings = live?.findings ?? checks?.findings ?? [];
  const unacknowledged = citations.filter(
    (c) => c.status === 'not_found' && !c.acknowledged,
  ).length;
  const scope = { workspaceId: props.workspaceId, draftVersionId: checks?.versionId ?? '' };

  async function runChecks() {
    if (checks === undefined) return;
    setChecking(true);
    setCheckFailed(false);
    const result = await checks.actions.run(scope);
    setChecking(false);
    if (!result.ok) {
      setCheckFailed(true);
      return;
    }
    setLive({
      citations: result.data.citations.items.map((c) => ({
        id: c.id,
        blockId: c.blockId,
        raw: c.raw,
        status: c.status,
        title: c.title,
        acknowledged: false,
      })),
      findings: result.data.findings,
    });
  }

  async function acknowledge(statement: string) {
    if (checks === undefined) return false;
    const ids = citations
      .filter((c) => c.status === 'not_found' && !c.acknowledged)
      .map((c) => c.id);
    const result = await checks.actions.acknowledge({
      ...scope,
      citationIds: ids,
      reason: statement,
    });
    if (!result.ok) return false;
    const done = new Set(result.data.acknowledged);
    setLive({
      citations: citations.map((c) => (done.has(c.id) ? { ...c, acknowledged: true } : c)),
      findings: checkFindings,
    });
    return true;
  }

  async function fix(target: Finding) {
    if (checks === undefined) return false;
    const result = await checks.actions.fix({ ...scope, findingId: target.id, confirm: true });
    if (!result.ok) return false;
    setUndoNo(props.versionNo);
    router.refresh();
    return true;
  }

  async function undo(versionNo: number) {
    const result = await props.actions.restore({
      workspaceId: props.workspaceId,
      draftId: props.draftId,
      versionNo,
    });
    if (!result.ok) return false;
    setUndoNo(null);
    router.refresh();
    return true;
  }

  async function exportFile(format: ExportFormat): Promise<ExportLink | null> {
    if (checks === undefined) return null;
    const queued = await checks.actions.exportDraft({
      workspaceId: props.workspaceId,
      draftId: props.draftId,
      versionNo: props.versionNo,
      format,
    });
    if (!queued.ok || queued.data.status !== 'ready') return null;
    const link = await checks.actions.download({
      workspaceId: props.workspaceId,
      exportId: queued.data.exportId,
    });
    return link.ok ? link.data : null;
  }

  const jump = (blockKey: string) => {
    setPanel(null);
    document.querySelector(`[data-block-key="${blockKey}"]`)?.scrollIntoView({ block: 'center' });
  };

  const go = useCallback(
    (direction: 1 | -1) => {
      const next = stepFinding(findings.length, finding, direction);
      if (next < 0) {
        setAnnouncement(t('findings.none'));
        return;
      }
      setFinding(next);
      const target = document.querySelector<HTMLElement>(
        `[data-block-key="${CSS.escape(findings[next] as string)}"]`,
      );
      target?.focus();
      target?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
      setAnnouncement(t('findings.position', { index: next + 1, total: findings.length }));
    },
    [findings, finding, t],
  );

  const latest = useRef({ save, go });
  useEffect(() => {
    latest.current = { save, go };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === 's') {
        event.preventDefault();
        void latest.current.save();
      } else if (mod && key === 'k') {
        // Draft actions replace the palette while the studio is open.
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenu((open) => !open);
      } else if (!mod && !isTyping(event.target) && (key === ']' || key === '[')) {
        event.preventDefault();
        latest.current.go(key === ']' ? 1 : -1);
      } else if (key === 'escape') {
        setMenu(false);
        setPanel(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // The `?` sheet and palette list the studio's keys while it is open.
  useEffect(
    () =>
      registerCommands(
        'help',
        DRAFT_STUDIO_SHORTCUTS.map((entry) => ({
          id: entry.id,
          labelKey: entry.labelKey,
          shortcut: entry.keys,
          perform: () => {
            if (entry.id === 'draft.save') void latest.current.save();
            else if (entry.id === 'draft.actions') setMenu(true);
            else if (entry.id === 'draft.nextFinding') latest.current.go(1);
            else if (entry.id === 'draft.prevFinding') latest.current.go(-1);
            else setPanel(null);
          },
        })),
      ),
    [],
  );

  const status = !online
    ? t('states.offlineQueued')
    : state === 'saving'
      ? t('states.saving')
      : state === 'conflict'
        ? t('states.conflict')
        : state === 'failed'
          ? t('states.saveFailed')
          : state === 'queued'
            ? t('states.offlineQueued')
            : dirty
              ? t('states.unsaved')
              : state === 'saved'
                ? t('states.saved')
                : '';

  const panelBody = (which: Panel | 'citations' | 'consistency') =>
    which === 'citations' ? (
      <CitationPanel
        citations={citations}
        checking={checking}
        failed={checkFailed}
        disabled={readOnly}
        onCheck={() => void runChecks()}
        onJump={jump}
        onAcknowledge={() => {
          setDialog('ack');
        }}
      />
    ) : which === 'consistency' ? (
      <ConsistencyPanel
        findings={checkFindings}
        checked={checks?.checked ?? false}
        disabled={readOnly}
        undoVersionNo={undoNo}
        onJump={jump}
        onFix={fix}
        onUndo={undo}
      />
    ) : which === 'facts' ? (
      <div className="flex flex-col gap-6">
        {factCheck === undefined ? null : (
          <FactCheckPanel
            verdicts={facts.verdicts}
            blockTexts={blockTexts}
            hasMatter={factCheck.matterId !== null}
            checking={facts.checking}
            failed={facts.failed}
            canUndo={fixUndo !== null}
            onJump={jumpToFact}
            onUndo={() => {
              if (fixUndo !== null) setBlocks(fixUndo);
              setFixUndo(null);
            }}
          />
        )}
        <FactsPanel
          facts={props.facts}
          selectedSlot={selectedSlot}
          disabled={readOnly}
          onInsert={(fact) => {
            if (selectedSlot === undefined) return;
            setBlocks((current) => insertFact(current, selectedSlot, fact.value));
            setDirty(true);
          }}
        />
        <AuthoritiesPanel
          authorities={props.authorities ?? []}
          selectedSlot={selectedSlot}
          disabled={readOnly}
          onInsert={(text) => {
            if (selectedSlot === undefined) return;
            setBlocks((current) => insertFact(current, selectedSlot, text));
            setDirty(true);
          }}
        />
      </div>
    ) : (
      <VersionDrawer
        versions={props.versions}
        currentVersionNo={props.versionNo}
        currentBlocks={blocks}
        disabled={readOnly}
        onRestore={(no) => void restore(no)}
      />
    );

  return (
    <div data-slot="draft-studio" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-xl font-semibold">{props.title}</h1>
        <span role="status" className="text-ink-muted text-sm">
          {status}
        </span>
        {!online ? (
          <span className="text-warn text-sm">
            {t('offline.banner')} {readOnly ? t('states.cachedCopy') : ''}
          </span>
        ) : null}
        {pending > 0 ? (
          <span className="text-ink-muted text-sm">{t('offline.queued', { count: pending })}</span>
        ) : null}
        {factCheck === undefined ? null : (
          <button
            type="button"
            aria-pressed={panel === 'facts'}
            onClick={() => {
              setPanel(panel === 'facts' ? null : 'facts');
            }}
            className="border-line focus-visible:ring-focus ms-auto min-h-11 rounded-md border px-3 text-sm focus-visible:ring-2 xl:hidden"
          >
            {t('factCheck.panel.tab')}
            {facts.count === 0 ? null : (
              <span
                data-slot="fact-check-badge"
                aria-label={t('factCheck.panel.badge', { count: facts.count })}
                className="bg-warn-subtle text-warn ms-1 rounded-full px-1.5 text-xs tabular-nums"
              >
                {facts.count}
              </span>
            )}
          </button>
        )}
        <div className="flex gap-2 xl:hidden">
          {(['facts', 'versions'] as const).map((which) => (
            <button
              key={which}
              type="button"
              aria-pressed={panel === which}
              title={t('shortcuts.togglePanel')}
              onClick={() => {
                setPanel(panel === which ? null : which);
              }}
              className="border-line focus-visible:ring-focus min-h-11 rounded-md border px-3 text-sm focus-visible:ring-2"
            >
              {t(`tabs.${which}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={readOnly || !dirty || state === 'saving'}
          onClick={() => void save()}
          className="bg-seal text-seal-fg focus-visible:ring-focus min-h-11 rounded-md px-4 text-sm focus-visible:ring-2 disabled:opacity-50"
        >
          {t('actions.save')}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        <aside aria-label={t('panels.facts.title')} className="hidden xl:block xl:overflow-y-auto">
          {panelBody('facts')}
        </aside>

        <main ref={editorRef} className="mx-auto w-full max-w-3xl" aria-label={t('editor.label')}>
          <DraftEditor
            blocks={blocks}
            slotValues={props.slotValues}
            aiTexts={props.aiTexts ?? {}}
            selectedSlot={selectedSlot}
            readOnly={readOnly}
            facts={
              factCheck?.matterId == null
                ? undefined
                : {
                    verdicts: facts.verdicts,
                    onFix: applyFactFix,
                    onIgnoreForMatter: (v) => void decideFact(v, 'ignored'),
                    onMarkAssertion: (v) => void decideFact(v, 'asserted'),
                  }
            }
            onSelectSlot={setSelectedSlot}
            onChange={(next, diff) => {
              setBlocks(next);
              setDirty(true);
              if (diff !== undefined) diffs.current = [...diffs.current, diff];
            }}
          />
          {props.panels}
          {checks === undefined ? null : (
            <div className="mt-6 flex flex-col gap-6">
              {panelBody('citations')}
              {panelBody('consistency')}
              <button
                type="button"
                onClick={() => {
                  setDialog('export');
                }}
                className="border-line min-h-11 self-start rounded-md border px-3 text-sm"
              >
                {t('export.action')}
              </button>
            </div>
          )}
        </main>
        {checks !== undefined && dialog === 'ack' ? (
          <AckDialog
            open
            count={unacknowledged}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            onConfirm={acknowledge}
          />
        ) : null}
        {checks !== undefined && dialog === 'export' ? (
          <DraftExportDialog
            open
            courtPreset={checks.courtPreset}
            aiAssisted={checks.aiAssisted}
            unacknowledged={unacknowledged}
            disabled={readOnly}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            onAcknowledge={() => {
              setDialog('ack');
            }}
            onExport={exportFile}
          />
        ) : null}

        <aside
          aria-label={t('panels.versions.title')}
          className="hidden xl:block xl:overflow-y-auto"
        >
          {panelBody('versions')}
        </aside>
      </div>

      {panel === null ? null : (
        // Below 1280 px: a side drawer from 768 px, a bottom sheet with tabs under it.
        <div
          role="dialog"
          aria-label={t(`tabs.${panel}`)}
          className="bg-surface border-line fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-lg border-t p-4 shadow-lg motion-safe:transition-transform md:inset-y-0 md:start-auto md:end-0 md:max-h-none md:w-80 md:rounded-none md:border-s md:border-t-0 xl:hidden"
        >
          <div role="tablist" className="mb-3 flex gap-2 md:hidden">
            {(['editor', 'facts', 'versions'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={tab === panel}
                onClick={() => {
                  setPanel(tab === 'editor' ? null : tab);
                }}
                className="aria-selected:bg-seal-subtle min-h-11 flex-1 rounded-md text-sm"
              >
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </div>
          {panelBody(panel)}
          <button
            type="button"
            onClick={() => {
              setPanel(null);
            }}
            className="border-line mt-3 min-h-11 rounded-md border px-3 text-sm"
          >
            {t('panels.versions.close')}
          </button>
        </div>
      )}

      {menu ? (
        <div
          role="dialog"
          aria-label={t('actions.title')}
          className="bg-surface border-line fixed start-1/2 top-24 z-50 flex w-72 -translate-x-1/2 flex-col gap-1 rounded-lg border p-2 shadow-lg"
        >
          <button
            type="button"
            autoFocus
            className="min-h-11 rounded-md px-2 text-start text-sm"
            onClick={() => {
              setMenu(false);
              void save();
            }}
          >
            {t('actions.save')}
          </button>
          {(['facts', 'versions'] as const).map((which) => (
            <button
              key={which}
              type="button"
              className="min-h-11 rounded-md px-2 text-start text-sm"
              onClick={() => {
                setMenu(false);
                setPanel(which);
              }}
            >
              {which === 'facts' ? t('actions.showFacts') : t('actions.showVersions')}
            </button>
          ))}
        </div>
      ) : null}

      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
        {factAnnouncement}
      </div>
    </div>
  );
}
