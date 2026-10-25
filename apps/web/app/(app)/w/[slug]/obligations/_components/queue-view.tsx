'use client';
// The obligation queue screen (#68). The rows arrive from the server; filters, the search, the
// group collapse state and the keyboard run on the client so the queue narrows at once. The tab and
// the filters live in the URL. Offline, mutations are kept and run when the connection returns
// (the row shows "Will sync"). Nothing on this screen sends anything.
import type { CertifiedCopyView, DefectView, ObligationOptions } from '@causedeck/core/obligations';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Input } from '@causedeck/ui/input';
import { isTypingTarget } from '@causedeck/ui/hooks';
import { ObligationEmpty } from '@causedeck/ui/patterns';
import { toast } from '@causedeck/ui/sonner';
import { Tabs, TabsList, TabsTrigger } from '@causedeck/ui/tabs';
import type { QueueGroup } from '@causedeck/validators/obligation';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';

import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import {
  OBLIGATION_TABS,
  QUEUE_GROUP_ORDER,
  filterQueue,
  groupItems,
  serialiseQueueParams,
  type NextStep,
  type ObligationTab,
  type QueueFilters,
  type QueueItem,
  type QueueParams,
} from '../../../../../../lib/obligations/queue-state.ts';
import type { Result } from '../../../../../../lib/safe-action.ts';
import {
  addObligationAction,
  closeObligationAction,
  reassignAction,
  rescheduleAction,
  useNextStepAction as createNextStep,
  type ObligationResult,
} from '../actions.ts';

import { CloseDialog, type CloseReason } from './close-dialog.tsx';
import { CopiesTab } from './copies-tab.tsx';
import { DefectsTab } from './defects-tab.tsx';
import { DetailSheet } from './detail-sheet.tsx';
import { QueueRow } from './obligation-row.tsx';
import { QueueGroupSection } from './queue-group.tsx';
import { QueueFilterBar } from './queue-filters.tsx';
import { ReschedulePopover } from './reschedule-popover.tsx';

export interface QueueViewProps {
  workspaceId: string;
  slug: string;
  items: QueueItem[];
  grouped: Record<QueueGroup, QueueItem[]>;
  defects: DefectView[];
  copies: CertifiedCopyView[];
  options: ObligationOptions;
  initial: QueueParams;
  canWrite: boolean;
  canTrack: boolean;
  forceOffline: boolean;
}

const SHORTCUT_ROWS = [
  ['next', 'j'],
  ['previous', 'k'],
  ['select', 'x'],
  ['done', 'd'],
  ['reschedule', 'r'],
  ['add', 'a'],
  ['open', 'o'],
  ['search', '/'],
  ['goQueue', 'g o'],
  ['helpItem', '?'],
] as const;

type Pending = () => Promise<Result<ObligationResult>>;
const today = () => new Date();

export function QueueView(props: QueueViewProps) {
  const { workspaceId, items, defects, copies, options, initial, canWrite, canTrack } = props;
  const t = useTranslations('obligations');
  const router = useRouter();
  const realOnline = useOnline();
  const online = realOnline && !props.forceOffline;
  const [tab, setTab] = useState<ObligationTab>(initial.tab);
  const [filters, setFilters] = useState<QueueFilters>(initial.filters);
  const [collapsed, setCollapsed] = useState<Set<QueueGroup>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closing, setClosing] = useState<QueueItem | null>(null);
  const [rescheduling, setRescheduling] = useState<QueueItem | null>(null);
  const [detail, setDetail] = useState<QueueItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [willSync, setWillSync] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const queued = useRef<{ id: string; run: Pending }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const chord = useRef(false);
  const storageKey = `causedeck:obligations:groups:${options.selfMemberId}`;

  // Group state persists per member, in this browser. Read after mount (the server render cannot
  // know it) and applied from a microtask, not inside the effect body.
  useEffect(() => {
    let saved: unknown = [];
    try {
      saved = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    } catch {
      // A blocked or corrupt store leaves every group open.
    }
    if (!Array.isArray(saved)) return;
    const open = saved;
    queueMicrotask(() => {
      setCollapsed(new Set(QUEUE_GROUP_ORDER.filter((g) => open.includes(g))));
    });
  }, [storageKey]);
  const toggleGroup = (group: QueueGroup) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(group)) next.add(group);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Persisting is best effort.
      }
      return next;
    });
  };

  // The URL carries the tab and the filters.
  useEffect(() => {
    const query = serialiseQueueParams({ tab, filters }).toString();
    window.history.replaceState(null, '', query === '' ? window.location.pathname : `?${query}`);
  }, [tab, filters]);

  const visible = useMemo(
    () =>
      filterQueue(
        items.filter((item) => !gone.has(item.id)),
        filters,
      ),
    [items, filters, gone],
  );
  const grouped = useMemo(() => groupItems(visible), [visible]);
  const flat = useMemo(() => QUEUE_GROUP_ORDER.flatMap((g) => grouped[g]), [grouped]);
  const current = flat.find((item) => item.id === selectedId) ?? null;

  const run = async (id: string, job: Pending, ok: string) => {
    if (!online) {
      queued.current.push({ id, run: job });
      setWillSync((prev) => new Set(prev).add(id));
      toast(t('toast.queued'));
      return true;
    }
    setBusy(true);
    try {
      const result = await job();
      if (!result.ok) {
        toast(t('toast.failed'));
        return false;
      }
      toast(ok);
      router.refresh();
      return true;
    } catch {
      toast(t('toast.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Back online: run what was kept, in order.
  useEffect(() => {
    if (!online || queued.current.length === 0) return;
    const jobs = queued.current.splice(0);
    void (async () => {
      for (const job of jobs) await job.run().catch(() => undefined);
      setWillSync(new Set());
      router.refresh();
    })();
  }, [online, router]);

  const ownerFor = () => options.selfMemberId;
  const onClose = async (input: { reason: CloseReason; note?: string }) => {
    if (closing === null) return;
    const target = closing;
    const done = await run(
      target.id,
      () => closeObligationAction({ workspaceId, obligationId: target.id, ...input }),
      t('toast.closed'),
    );
    setClosing(null);
    if (done && online) setGone((prev) => new Set(prev).add(target.id));
  };
  const onReschedule = async (input: { dueDate: string; reason: string }) => {
    if (rescheduling === null) return;
    const target = rescheduling;
    await run(
      target.id,
      () => rescheduleAction({ workspaceId, obligationId: target.id, ...input }),
      t('toast.rescheduled'),
    );
    setRescheduling(null);
  };
  const onUseStep = async (item: QueueItem, step: NextStep) => {
    await run(
      item.id,
      () =>
        createNextStep({
          workspaceId,
          type: step.type,
          text: step.text,
          matterId: item.matterId,
          dueDate: item.dueDate,
          ownerMemberId: item.ownerMemberId ?? ownerFor(),
        }),
      t('toast.used'),
    );
  };

  // Keyboard: j/k move, x selects, d and r act on the selected row (a focused row handles them
  // itself first), a adds, o opens, / searches, `g o` goes to the queue and ? lists the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key;
      if (chord.current) {
        chord.current = false;
        if (key === 'o') {
          event.preventDefault();
          setTab('queue');
        }
        return;
      }
      const index = flat.findIndex((item) => item.id === selectedId);
      if (key === 'g') {
        chord.current = true;
        window.setTimeout(() => (chord.current = false), 1000);
      } else if (key === 'j' || key === 'k') {
        const next = flat[Math.max(0, Math.min(flat.length - 1, index + (key === 'j' ? 1 : -1)))];
        if (next !== undefined) setSelectedId(next.id);
      } else if (key === 'x' && current !== null) {
        setChecked((prev) => {
          const next = new Set(prev);
          if (!next.delete(current.id)) next.add(current.id);
          return next;
        });
      } else if (key === 'd' && current !== null && canWrite) setClosing(current);
      else if (key === 'r' && current !== null && canWrite) setRescheduling(current);
      else if (key === 'a' && canTrack) setAdding(true);
      else if (key === 'o' && current !== null) setDetail(current);
      else if (key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (key === '?') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [flat, selectedId, current, canWrite, canTrack]);

  const now = today();
  const queueBody =
    visible.length === 0 ? (
      <ObligationEmpty
        title={
          items.length === 0 ? `${t('empty.title')} ${t('empty.description')}` : t('empty.filtered')
        }
      />
    ) : (
      QUEUE_GROUP_ORDER.filter((g) => grouped[g].length > 0).map((group) => (
        <QueueGroupSection
          key={group}
          group={group}
          count={grouped[group].length}
          collapsed={collapsed.has(group)}
          onToggle={() => {
            toggleGroup(group);
          }}
        >
          {grouped[group].map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              checked={checked.has(item.id)}
              canAct={canWrite}
              offline={!online}
              willSync={willSync.has(item.id)}
              now={now}
              onDone={() => {
                setClosing(item);
              }}
              onReschedule={() => {
                setRescheduling(item);
              }}
              onOpen={() => {
                setSelectedId(item.id);
                setDetail(item);
              }}
              onToggle={() => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(item.id)) next.add(item.id);
                  return next;
                });
              }}
            />
          ))}
        </QueueGroupSection>
      ))
    );

  return (
    <div data-route="obligations" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        {canTrack ? (
          <Button
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('add.open')}
          </Button>
        ) : null}
      </div>
      {online ? null : (
        <p role="status" data-pattern-state="offline" className="text-ink-muted text-sm">
          {t('offline')}
        </p>
      )}
      {canWrite ? null : (
        <p role="status" className="text-ink-muted text-sm">
          {t('readOnly')}
        </p>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as ObligationTab);
        }}
      >
        <TabsList aria-label={t('tabs.label')}>
          {OBLIGATION_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'queue' ? (
        <>
          <QueueFilterBar
            filters={filters}
            matters={options.matters}
            members={options.members}
            searchRef={searchRef}
            onChange={setFilters}
          />
          <div data-slot="obligation-queue" className="flex flex-col">
            {queueBody}
          </div>
        </>
      ) : tab === 'defects' ? (
        <DefectsTab defects={defects} />
      ) : (
        <CopiesTab copies={copies} />
      )}
      <CloseDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
        title={closing?.description ?? ''}
        pending={busy}
        onSubmit={(input) => void onClose(input)}
      />
      <ReschedulePopover
        open={rescheduling !== null}
        onOpenChange={(open) => {
          if (!open) setRescheduling(null);
        }}
        title={rescheduling?.description ?? ''}
        current={rescheduling?.dueDate ?? null}
        pending={busy}
        onSubmit={(input) => void onReschedule(input)}
      />
      <DetailSheet
        item={detail}
        members={options.members}
        canAct={canWrite}
        pending={busy}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onReassign={(ownerMemberId) => {
          if (detail === null) return;
          const id = detail.id;
          void run(
            id,
            () => reassignAction({ workspaceId, obligationId: id, ownerMemberId }),
            t('toast.reassigned'),
          );
        }}
        onUseStep={(item, step) => void onUseStep(item, step)}
      />
      <AddDialog
        open={adding}
        options={options}
        pending={busy}
        onOpenChange={setAdding}
        onSubmit={(input) => {
          void (async () => {
            const ok = await run(
              'add',
              () => addObligationAction({ workspaceId, ...input }),
              t('toast.added'),
            );
            if (ok) setAdding(false);
          })();
        }}
      />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent data-slot="obligation-shortcuts">
          <DialogHeader>
            <DialogTitle>{t('shortcuts.title')}</DialogTitle>
            <DialogDescription>{t('shortcuts.description')}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {SHORTCUT_ROWS.map(([id, keys]) => (
              <div key={id} className="contents">
                <dt>
                  <kbd className="bg-surface-sunken rounded px-1.5 font-mono">{keys}</kbd>
                </dt>
                <dd>{t(`shortcuts.${id}`)}</dd>
              </div>
            ))}
          </dl>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setHelp(false);
              }}
            >
              {t('shortcuts.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface AddDialogProps {
  open: boolean;
  options: ObligationOptions;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    matterId: string;
    description: string;
    dueDate: string | null;
    ownerMemberId: string;
  }) => void;
}

function AddDialog({ open, options, pending, onOpenChange, onSubmit }: AddDialogProps) {
  const t = useTranslations('obligations.add');
  const [text, setText] = useState('');
  const [matterId, setMatterId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [due, setDue] = useState('');
  const matter = matterId || options.matters[0]?.id || '';
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (text.trim() === '' || matter === '') return;
    onSubmit({
      matterId: matter,
      description: text.trim(),
      dueDate: due === '' ? null : due,
      ownerMemberId: ownerId || options.selfMemberId,
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="obligation-add">
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            {t('text')}
            <Input
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('matter')}
            <select
              className="border-line bg-surface min-h-11 rounded-md border px-2"
              value={matter}
              onChange={(event) => {
                setMatterId(event.target.value);
              }}
            >
              {options.matters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('owner')}
            <select
              className="border-line bg-surface min-h-11 rounded-md border px-2"
              value={ownerId || options.selfMemberId}
              onChange={(event) => {
                setOwnerId(event.target.value);
              }}
            >
              {options.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('due')}
            <Input
              type="date"
              value={due}
              onChange={(event) => {
                setDue(event.target.value);
              }}
            />
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
