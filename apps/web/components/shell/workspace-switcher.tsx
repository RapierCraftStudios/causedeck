'use client';

import { initials } from '@causedeck/ui/avatar';
import { Badge } from '@causedeck/ui/badge';
import { Check, ChevronsUpDown, Plus, Ticket } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type KeyboardEvent, type SyntheticEvent } from 'react';

import { invitePath, inviteTokenFrom } from '../../lib/capture/paste/invite-input.ts';
import type { Membership, Workspace } from '../../lib/workspace-context.ts';

import { railHidden } from './sidebar-collapse.tsx';
import { loadShellOverlays, useShellOverlays } from './use-shell-overlays.ts';

const cacheClearers = new Set<() => void>();

/**
 * Register a client cache to drop on a workspace switch (hard isolation: nothing from the previous
 * workspace survives). Returns the unregister function.
 */
export function registerClientCache(clear: () => void): () => void {
  cacheClearers.add(clear);
  return () => {
    cacheClearers.delete(clear);
  };
}

/** Clear every registered client cache. */
export function clearClientCaches(): void {
  for (const clear of cacheClearers) clear();
}

const normalise = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

/** Memberships whose name or slug contains `query` (case- and width-insensitive). */
export function filterMemberships(memberships: readonly Membership[], query: string): Membership[] {
  const needle = normalise(query.trim());
  if (needle === '') return [...memberships];
  return memberships.filter(
    ({ workspace }) =>
      normalise(workspace.name).includes(needle) || normalise(workspace.slug).includes(needle),
  );
}

/** Initials-avatar tones from the token palette; a workspace always gets the same one. */
const TONES = [
  'bg-accent-soft text-accent',
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-stage-listed-soft text-stage-listed',
  'bg-stage-reserved-soft text-stage-reserved',
] as const;

export function workspaceTone(slug: string): string {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return TONES[hash % TONES.length] ?? TONES[0];
}

function WorkspaceMark({ workspace }: { workspace: Workspace }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-[8px] text-xs font-semibold ${workspaceTone(workspace.slug)}`}
    >
      {initials(workspace.name)}
    </span>
  );
}

export interface WorkspaceSwitcherProps {
  current: Workspace;
  memberships: readonly Membership[];
  /** `sidebar`: mark and name (name hidden in the rail). `topbar`: name with a chevron (phones). */
  variant: 'sidebar' | 'topbar';
}

/**
 * Menu button opening a 288 px popover (a bottom sheet in the phone topbar) of the user's
 * memberships: type to filter, arrows to move, Enter to switch. Switching is a hard switch: client
 * caches are cleared and the app navigates to the other workspace's Today.
 */
export function WorkspaceSwitcher({ current, memberships, variant }: WorkspaceSwitcherProps) {
  const t = useTranslations('shell');
  const router = useRouter();
  const overlays = useShellOverlays();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const results = filterMemberships(memberships, query);
  const active = Math.min(activeIndex, Math.max(results.length - 1, 0));
  const optionId = (index: number) => `${listId}-option-${String(index)}`;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActiveIndex(
        Math.max(
          0,
          memberships.findIndex((m) => m.workspace.slug === current.slug),
        ),
      );
    }
  };

  const select = (membership: Membership) => {
    setOpen(false);
    if (membership.workspace.slug === current.slug) return;
    setSwitchingTo(membership.workspace.slug);
    clearClientCaches();
    router.push(`/w/${encodeURIComponent(membership.workspace.slug)}/today`);
    router.refresh();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = results.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: active >= last ? 0 : active + 1,
      ArrowUp: active <= 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    const move = moves[event.key];
    if (move !== undefined && results.length > 0) {
      event.preventDefault();
      setActiveIndex(move);
      return;
    }
    if (event.key === 'Enter') {
      const chosen = results[active];
      if (chosen === undefined) return;
      event.preventDefault();
      select(chosen);
    }
  };

  /** Clicked before the overlay chunk arrived: open as soon as it does. */
  const openEarly = () => {
    onOpenChange(true);
    void loadShellOverlays();
  };

  const trigger =
    variant === 'sidebar' ? (
      <button
        type="button"
        aria-label={`${t('topbar.openSwitcher')}: ${current.name}`}
        data-switcher-trigger="sidebar"
        data-focus-key="switcher-sidebar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={overlays ? undefined : openEarly}
        className="hover:bg-accent-soft/60 focus-visible:outline-ring flex h-11 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left outline-none group-data-[sidebar=collapsed]/shell:justify-center focus-visible:outline-2 group-data-[sidebar=auto]/shell:max-xl:justify-center"
      >
        <WorkspaceMark workspace={current} />
        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${railHidden}`}>
          {current.name}
        </span>
        <ChevronsUpDown
          aria-hidden="true"
          className={`text-ink-subtle size-4 shrink-0 ${railHidden}`}
        />
      </button>
    ) : (
      <button
        type="button"
        aria-label={`${t('topbar.openSwitcher')}: ${current.name}`}
        data-switcher-trigger="topbar"
        data-focus-key="switcher-topbar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={overlays ? undefined : openEarly}
        className="focus-visible:outline-ring flex h-11 min-w-0 items-center gap-1 rounded-md px-1 text-left outline-none focus-visible:outline-2"
      >
        <span data-current-workspace="" className="truncate font-serif text-lg font-medium">
          {current.name}
        </span>
        <ChevronsUpDown aria-hidden="true" className="text-ink-subtle size-4 shrink-0" />
      </button>
    );

  const switching = switchingTo !== null && switchingTo !== current.slug;

  const panel = (
    <SwitcherPanel
      current={current}
      results={results}
      active={active}
      query={query}
      listId={listId}
      optionId={optionId}
      onQueryChange={(value) => {
        setQuery(value);
        setActiveIndex(0);
      }}
      onKeyDown={onKeyDown}
      onHover={setActiveIndex}
      onSelect={select}
      onCreate={() => {
        setOpen(false);
      }}
      onJoin={(token) => {
        setOpen(false);
        router.push(invitePath(token));
      }}
    />
  );

  let switcher = trigger;
  if (overlays && variant === 'sidebar') {
    switcher = (
      <overlays.Popover open={open} onOpenChange={onOpenChange}>
        <overlays.PopoverTrigger asChild>{trigger}</overlays.PopoverTrigger>
        <overlays.PopoverContent
          align="start"
          aria-label={t('switcher.label')}
          className="flex w-72 flex-col gap-1 p-1.5"
        >
          {panel}
        </overlays.PopoverContent>
      </overlays.Popover>
    );
  } else if (overlays) {
    // Phones: the same list as a bottom sheet.
    switcher = (
      <overlays.Sheet open={open} onOpenChange={onOpenChange}>
        <overlays.SheetTrigger asChild>{trigger}</overlays.SheetTrigger>
        <overlays.SheetContent
          side="bottom"
          data-switcher-sheet=""
          aria-describedby={undefined}
          labels={{ close: t('sheet.close') }}
          className="gap-2 overflow-y-auto"
        >
          <overlays.SheetHeader>
            <overlays.SheetTitle>{t('switcher.label')}</overlays.SheetTitle>
          </overlays.SheetHeader>
          <div className="flex flex-col gap-1">{panel}</div>
        </overlays.SheetContent>
      </overlays.Sheet>
    );
  }

  return (
    <>
      {switcher}
      {switching ? (
        <div
          role="status"
          data-switching=""
          className="bg-surface/70 animate-fade-in z-overlay fixed inset-0 flex items-center justify-center duration-150 motion-reduce:animate-none"
        >
          <span className="text-ink-muted text-sm">{t('switcher.switching')}</span>
        </div>
      ) : null}
    </>
  );
}

interface SwitcherPanelProps {
  current: Workspace;
  results: readonly Membership[];
  active: number;
  query: string;
  listId: string;
  optionId: (index: number) => string;
  onQueryChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onHover: (index: number) => void;
  onSelect: (membership: Membership) => void;
  /** Closes the panel as `Create workspace` navigates to `/onboarding`. */
  onCreate: () => void;
  /** Opens `/invite/<token>` (#1074): the invitation page previews it and accepts it. */
  onJoin: (token: string) => void;
}

/** Filter, membership listbox and footer: shared by the sidebar popover and the phone sheet. */
function SwitcherPanel({
  current,
  results,
  active,
  query,
  listId,
  optionId,
  onQueryChange,
  onKeyDown,
  onHover,
  onSelect,
  onCreate,
  onJoin,
}: SwitcherPanelProps) {
  const t = useTranslations('shell');
  const joinId = useId();
  const [joining, setJoining] = useState(false);
  const [invite, setInvite] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submitInvite = (event: SyntheticEvent) => {
    event.preventDefault();
    const token = inviteTokenFrom(invite);
    if (token === null) {
      setInvalid(true);
      return;
    }
    onJoin(token);
  };
  return (
    <>
      <input
        type="text"
        role="combobox"
        aria-label={t('switcher.filter')}
        aria-controls={listId}
        aria-expanded="true"
        aria-autocomplete="list"
        aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
        placeholder={t('switcher.filter')}
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        className="border-line-control bg-surface focus-visible:outline-ring h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:outline-2"
      />
      <ul id={listId} role="listbox" aria-label={t('switcher.label')} className="flex flex-col">
        {results.map((membership, index) => {
          const isCurrent = membership.workspace.slug === current.slug;
          return (
            <li
              key={membership.workspace.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              aria-current={isCurrent ? 'true' : undefined}
              data-slug={membership.workspace.slug}
              onPointerMove={() => {
                onHover(index);
              }}
              onClick={() => {
                onSelect(membership);
              }}
              className={`flex h-12 cursor-default items-center gap-2.5 rounded-md px-2 ${index === active ? 'bg-accent-soft' : ''}`}
            >
              <WorkspaceMark workspace={membership.workspace} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {membership.workspace.name}
              </span>
              <Badge data-role={membership.role}>{t(`roles.${membership.role}`)}</Badge>
              {isCurrent ? (
                <Check aria-label={t('switcher.current')} className="text-accent size-4 shrink-0" />
              ) : (
                <span className="size-4 shrink-0" />
              )}
            </li>
          );
        })}
      </ul>
      {results.length === 0 ? (
        <p role="status" className="text-ink-muted px-2 py-3 text-sm">
          {t('switcher.noMatches')}
        </p>
      ) : null}
      <div className="border-line mt-1 flex flex-col border-t pt-1">
        <Link
          href="/onboarding"
          onClick={onCreate}
          data-switcher-create=""
          className="text-ink hover:bg-accent-soft/60 focus-visible:outline-ring flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:outline-2"
        >
          <Plus aria-hidden="true" className="size-4" />
          {t('switcher.create')}
        </Link>
        {joining ? (
          <form
            onSubmit={submitInvite}
            data-switcher-join-form=""
            className="flex flex-col gap-1.5 p-2"
          >
            <label htmlFor={joinId} className="text-sm font-medium">
              {t('switcher.joinLabel')}
            </label>
            <input
              id={joinId}
              type="text"
              value={invite}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={t('switcher.joinPlaceholder')}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${joinId}-error` : undefined}
              onChange={(event) => {
                setInvite(event.target.value);
                setInvalid(false);
              }}
              className="border-line-control bg-surface focus-visible:outline-ring h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:outline-2"
            />
            {invalid ? (
              <p id={`${joinId}-error`} role="alert" className="text-danger text-xs">
                {t('switcher.joinInvalid')}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={invite.trim() === ''}
              className="bg-accent text-accent-ink focus-visible:outline-ring h-9 self-start rounded-md px-3 text-sm font-medium outline-none focus-visible:outline-2 disabled:opacity-60"
            >
              {t('switcher.joinSubmit')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            data-switcher-join=""
            onClick={() => {
              setJoining(true);
            }}
            className="text-ink hover:bg-accent-soft/60 focus-visible:outline-ring flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus-visible:outline-2"
          >
            <Ticket aria-hidden="true" className="size-4" />
            {t('switcher.join')}
          </button>
        )}
      </div>
    </>
  );
}
