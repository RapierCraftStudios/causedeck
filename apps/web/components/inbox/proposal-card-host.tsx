'use client';
// Maps an inbox item to its card (#48): a Proposal Card (`@causedeck/ui/patterns`) for each
// `ProposalKind`, the Conflict Card for a next date that disagrees with the confirmed one and the
// unreadable-capture card. The host owns what is local to one card (the inline editor, the reassign
// panel, the error line); the shell owns the decisions and what happens after them. A sensitive
// matter's item shows a lock and no content, and its actions are off. Nothing here sends, files or
// pays anything.
import { formatDate, type Locale } from '@causedeck/i18n';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import {
  ProposalCard,
  type Anchor,
  type Proposal,
  type ProvenanceSource,
} from '@causedeck/ui/patterns';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { InboxItemView } from '../../lib/inbox/view.ts';

import { DateConflict } from './proposal-kinds/date-conflict.tsx';
import { descriptorFor, type Payload } from './proposal-kinds/index.ts';
import { UnreadableCapture } from './proposal-kinds/unreadable-capture.tsx';

export interface MatterHit {
  id: string;
  title: string;
}

/** What a card may ask of the shell. Each rejects when the server refused; the card then says so. */
export interface CardHandlers {
  confirm: (item: InboxItemView) => Promise<void>;
  editConfirm: (item: InboxItemView, payload: Payload) => Promise<void>;
  dismiss: (item: InboxItemView, suppress: boolean) => Promise<void>;
  chooseDate: (
    item: InboxItemView,
    choice: 'keep' | 'use' | 'other',
    date?: string,
  ) => Promise<void>;
  keepAttachment: (item: InboxItemView) => Promise<void>;
  keyLine: (item: InboxItemView, text: string) => Promise<void>;
  reassign: (item: InboxItemView, matter: MatterHit) => Promise<void>;
  searchMatters: (query: string) => Promise<MatterHit[]>;
  retake: () => void;
}

export interface ProposalCardHostProps {
  item: InboxItemView;
  locale: Locale;
  handlers: CardHandlers;
  /** Decisions need the server: confirm, edit and dismiss are off while offline. */
  offline: boolean;
  readOnly: boolean;
  /** The card collapsed after a confirmation; the shell drops it. */
  onConfirmed: (item: InboxItemView) => void;
  /** The card started collapsing: move focus on. */
  onCollapse: (item: InboxItemView) => void;
}

const confidenceLevel = (value: number | null): 'high' | 'check' =>
  value !== null && value >= 0.85 ? 'high' : 'check';

/** One run of an asynchronous card action with its error line. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, run };
}

function ReassignPanel({
  item,
  handlers,
  locale,
}: {
  item: InboxItemView;
  handlers: CardHandlers;
  locale: Locale;
}) {
  const t = useTranslations('inbox');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MatterHit[] | null>(null);
  const { busy, failed, run } = useRun();
  const until = item.reassignUntil;
  if (until === null || item.captureId === null) return null;

  const search = (event: SyntheticEvent) => {
    event.preventDefault();
    void run(async () => {
      setHits(await handlers.searchMatters(query));
    });
  };

  return (
    <div className="grid gap-2 text-sm" data-slot="reassign">
      <Button
        variant="link"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="justify-self-start"
      >
        {t('reassign.prompt')}
      </Button>
      {open ? (
        <div className="bg-surface-sunken grid gap-2 rounded-lg p-3">
          <p className="text-ink-muted text-xs">
            {t('reassign.explain', { date: formatDate(until, { locale }) })}
          </p>
          <form onSubmit={search} className="flex gap-2" role="search">
            <Input
              aria-label={t('reassign.search')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={t('reassign.search')}
              className="pointer-coarse:min-h-11"
            />
            <Button type="submit" variant="secondary" disabled={busy || query.trim() === ''}>
              {t('reassign.search')}
            </Button>
          </form>
          {failed ? (
            <p role="alert" className="text-danger text-xs">
              {t('card.failed')}
            </p>
          ) : null}
          {hits === null ? null : hits.length === 0 ? (
            <p className="text-ink-muted text-xs">{t('reassign.none')}</p>
          ) : (
            <ul className="grid gap-1">
              {hits.map((hit) => (
                <li key={hit.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{hit.title}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      void run(() => handlers.reassign(item, hit));
                    }}
                  >
                    {t('reassign.move')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function InlineEditor({
  item,
  onCancel,
  onSave,
  busy,
}: {
  item: InboxItemView;
  onCancel: () => void;
  onSave: (payload: Payload) => void;
  busy: boolean;
}) {
  const t = useTranslations('inbox');
  const descriptor = descriptorFor(item.kind);
  const payload = item.payload ?? {};
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      descriptor.fields.map((field) => {
        const value = payload[field.key];
        return [
          field.key,
          typeof value === 'string' || typeof value === 'number' ? String(value) : '',
        ];
      }),
    ),
  );

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const next: Payload = { ...payload };
    for (const field of descriptor.fields) {
      const raw = values[field.key] ?? '';
      if (field.type === 'number') next[field.key] = raw === '' ? null : Number(raw);
      else next[field.key] = raw === '' ? null : raw;
    }
    onSave(next);
  };

  return (
    <form
      onSubmit={submit}
      className="bg-surface-sunken grid gap-3 rounded-lg p-3"
      data-slot="inline-editor"
    >
      {descriptor.fields.map((field) => (
        <label key={field.key} className="grid gap-1 text-sm">
          <span>{t(`card.field.${field.label}`)}</span>
          <Input
            type={field.type}
            value={values[field.key] ?? ''}
            onChange={(event) => {
              setValues((current) => ({ ...current, [field.key]: event.target.value }));
            }}
            autoFocus
            className="pointer-coarse:min-h-11"
          />
        </label>
      ))}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {t('card.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('card.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function ProposalCardHost({
  item,
  locale,
  handlers,
  offline,
  readOnly,
  onConfirmed,
  onCollapse,
}: ProposalCardHostProps) {
  const t = useTranslations('inbox');
  const headerId = useId();
  const [editing, setEditing] = useState(false);
  const { busy, failed, run } = useRun();
  const disabledReason = offline ? t('offline.decisions') : undefined;
  const error = failed ? t('card.failed') : undefined;

  if (item.type === 'conflict') {
    return (
      <DateConflict
        item={item}
        locale={locale}
        disabled={busy || offline}
        disabledReason={disabledReason}
        readOnly={readOnly}
        error={error}
        onKeep={() => void run(() => handlers.chooseDate(item, 'keep'))}
        onUse={() => void run(() => handlers.chooseDate(item, 'use'))}
        onOther={(date) => void run(() => handlers.chooseDate(item, 'other', date))}
      />
    );
  }
  if (item.type === 'unreadable') {
    return (
      <UnreadableCapture
        item={item}
        disabled={busy || offline}
        disabledReason={disabledReason}
        readOnly={readOnly}
        error={error}
        onRetake={handlers.retake}
        onKeep={() => void run(() => handlers.keepAttachment(item))}
        onKeyLine={(text) => void run(() => handlers.keyLine(item, text))}
      />
    );
  }

  const descriptor = descriptorFor(item.kind);
  const payload: Payload = item.payload ?? {};
  const ctx = { locale };
  const kindLabel = t(`card.kind.${item.kind ?? 'task'}` as 'card.kind.task');
  const anchor = item.anchors[0];
  const matterLine =
    item.matterTitle === null
      ? null
      : item.caseNumber === null
        ? item.matterTitle
        : t('card.matter', { matter: item.matterTitle, caseNumber: item.caseNumber });
  const date = descriptor.text(payload, ctx);
  const sentence =
    item.kind === 'next_date' && anchor !== undefined && date !== ''
      ? t('card.readNextDate', { date, page: anchor.page })
      : t('card.read');

  const source: ProvenanceSource = {
    kind: 'capture',
    label: anchor === undefined ? kindLabel : t('preview.page', { page: anchor.page }),
    state: 'proposed',
    ...(anchor === undefined
      ? {}
      : { quote: anchor.quote, page: anchor.page, anchorId: anchor.id }),
    ...(item.confidence === null ? {} : { confidence: item.confidence }),
  };
  const proposal: Proposal<Payload> = {
    id: item.id,
    title: item.sensitive ? t('card.sensitive') : sentence,
    after: payload,
    source,
    level: 'L2',
  };
  const anchorView: Anchor | undefined =
    anchor === undefined
      ? undefined
      : {
          id: anchor.id,
          documentTitle: kindLabel,
          quote: anchor.quote,
          page: anchor.page,
          ...(anchor.highlight === null ? {} : { highlight: anchor.highlight }),
        };
  const level = confidenceLevel(item.confidence);

  return (
    <article aria-labelledby={headerId} data-item-id={item.id} className="grid gap-2">
      <header id={headerId} className="flex flex-wrap items-center gap-x-2 text-sm">
        {item.sensitive ? <Lock aria-hidden="true" className="text-ink-muted size-3.5" /> : null}
        <span className="text-ink font-medium">{kindLabel}</span>
        {matterLine === null ? null : <span className="text-ink-muted">{matterLine}</span>}
        <span className="text-ink-muted text-xs">
          {t('card.confidence.label', { level: t(`card.confidence.${level}`) })}
        </span>
        <span aria-hidden="true" className="bg-line relative h-1 w-12 overflow-hidden rounded-full">
          <span
            className="bg-accent absolute inset-y-0 left-0"
            style={{ width: `${String(Math.round((item.confidence ?? 0) * 100))}%` }}
          />
        </span>
      </header>
      <ProposalCard<Payload>
        proposal={proposal}
        anchor={anchorView}
        renderValue={(value) =>
          item.sensitive ? (
            <Lock aria-hidden="true" className="size-4" />
          ) : (
            descriptor.render(value, ctx)
          )
        }
        offline={offline}
        viewOnly={readOnly || item.sensitive}
        disabled={busy}
        error={error}
        labels={{ offline: t('offline.decisions'), viewOnly: t('readOnly') }}
        onConfirm={() => handlers.confirm(item)}
        onEdit={() => {
          if (descriptor.fields.length > 0) setEditing(true);
        }}
        onDismiss={() => void run(() => handlers.dismiss(item, false))}
        onCollapse={() => {
          onCollapse(item);
        }}
        onConfirmed={() => {
          onConfirmed(item);
        }}
      />
      {editing ? (
        <InlineEditor
          item={item}
          busy={busy}
          onCancel={() => {
            setEditing(false);
          }}
          onSave={(next) => void run(() => handlers.editConfirm(item, next))}
        />
      ) : null}
      {readOnly || item.sensitive ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button
            variant="link"
            size="sm"
            disabled={busy || offline}
            title={disabledReason}
            onClick={() => void run(() => handlers.dismiss(item, true))}
          >
            {t('card.dontSuggest')}
          </Button>
          <ReassignPanel item={item} handlers={handlers} locale={locale} />
        </div>
      )}
    </article>
  );
}
