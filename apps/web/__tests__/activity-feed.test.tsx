// @vitest-environment jsdom
// `/w/[slug]/activity` automation feed (#49): newest first and grouped by day, the Undo button with
// its target and days left, the undo dialog (cascade preview, engine reason and `Open the matter`
// when the engine refuses), the struck-through undone item, view-only and window-ended notes,
// redacted rows, filters in the URL, empty and filtered-empty states, offline, keyboard j/k/u/ / ?
// and focus returning to the item, load more. Every string comes from the catalogs.
import type { ActivityPage, ActivityView } from '@causedeck/core/automation';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';

import { catalogs } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/w/chennai-solo/activity',
}));

const { ActivityFeed } = await import('../components/activity/activity-feed.tsx');
type FeedProps = Parameters<typeof ActivityFeed>[0];

const en = catalogs.en.activity;
const WORKSPACE = { id: '00000000-0000-4000-8000-00000000a001', slug: 'chennai-solo' };
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const MATTER = '00000000-0000-4000-8000-0000000000b1';
const NOW_ISO = '2026-10-21T06:00:00.000Z';
const MEMBERS = [{ userId: OWNER, name: 'Asha Rao' }];

let counter = 0;
function activity(overrides: Partial<ActivityView> = {}): ActivityView {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  return {
    id,
    kind: 'document_attach',
    level: 'L3',
    actor: 'system',
    actorUserId: null,
    summary: `Attached order ${String(counter)} to W.P. 12345 of 2026`,
    redacted: false,
    matterId: MATTER,
    matterTitle: 'Ilango v. State (fictional)',
    captureId: null,
    inputSource: 'document',
    model: null,
    modelVersion: null,
    region: null,
    confidence: '0.930',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-10-21T03:00:00.000Z',
    undoExpiresAt: '2026-10-28T03:00:00.000Z',
    undoneAt: null,
    undoneBy: null,
    cascadeGroupId: null,
    undoable: true,
    ...overrides,
  };
}

function fakeActions() {
  return {
    loadMore: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { items: [activity({ summary: 'Loaded later' })], nextCursor: null, canUndo: true },
      }),
    ),
    preview: vi.fn((input: { workspaceId: string; activityId: string }) =>
      Promise.resolve({
        ok: true as const,
        data: {
          activityId: input.activityId,
          undoable: true,
          blockedReason: null as string | null,
          willRemove: [
            {
              activityId: input.activityId,
              kind: 'document_attach',
              summary: 'Attached the order',
            },
            { activityId: 'child-1', kind: 'task', summary: 'Created a task: call the clerk' },
          ],
          matterId: MATTER,
        },
      }),
    ),
    undo: vi.fn((input: { workspaceId: string; activityId: string }) =>
      Promise.resolve({
        ok: true as const,
        data: {
          status: 'undone' as const,
          undone: [{ activityId: input.activityId, kind: 'document_attach', summary: 'x' }],
          skipped: [],
        },
      }),
    ),
    undoCapture: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { status: 'undone' as const, undone: [], skipped: [] },
      }),
    ),
    reassign: vi.fn(() => Promise.resolve({ ok: true as const, data: {} })),
    searchMatters: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })),
  };
}

function view(
  items: ActivityView[],
  props: Partial<Omit<FeedProps, 'initialPage' | 'actions'>> & {
    page?: Partial<ActivityPage>;
    actions?: ReturnType<typeof fakeActions>;
  } = {},
) {
  const actions = props.actions ?? fakeActions();
  const { page, ...rest } = props;
  const ui: ReactNode = (
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <ActivityFeed
        workspace={WORKSPACE}
        initialPage={{ items, nextCursor: null, canUndo: true, ...page }}
        members={MEMBERS}
        currentUserId={OWNER}
        role="owner"
        filters={{}}
        nowIso={NOW_ISO}
        {...rest}
        actions={actions}
      />
    </NextIntlClientProvider>
  );
  render(ui);
  return actions;
}

let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  mockMatchMedia();
  stubResizeObserver();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rowOf = (summary: string) => screen.getByText(summary).closest('li') as HTMLElement;

describe('activity feed', () => {
  it('groups by IST day under Today and Yesterday headings, newest first', () => {
    const today = activity({ summary: 'Today item' });
    const yesterday = activity({
      summary: 'Yesterday item',
      level: 'L2',
      undoable: false,
      createdAt: '2026-10-20T05:00:00.000Z',
    });
    const older = activity({
      summary: 'Older item',
      undoable: false,
      createdAt: '2026-10-10T05:00:00.000Z',
      undoExpiresAt: '2026-10-17T05:00:00.000Z',
    });
    view([today, yesterday, older]);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([en.feed.today, en.feed.yesterday]);
    expect(headings[2]).toContain('2026');
    expect(screen.getByRole('region', { name: en.feed.label })).toBeTruthy();
    const order = [...document.querySelectorAll('[data-slot="activity-summary"]')].map(
      (el) => el.textContent,
    );
    expect(order).toEqual(['Today item', 'Yesterday item', 'Older item']);
  });

  it('shows level, source, matter link, confidence, and keeps model detail behind an expander', () => {
    const item = activity({
      summary: 'Attached the order',
      model: 'sarvam-m',
      modelVersion: '2026-09',
      region: 'ap-south-1',
      confirmedBy: OWNER,
      confirmedAt: '2026-10-21T04:00:00.000Z',
    });
    view([item]);
    const row = rowOf('Attached the order');
    expect(within(row).getByText(en.item.level.L3)).toBeTruthy();
    expect(within(row).getByText(en.item.source.document)).toBeTruthy();
    expect(
      within(row)
        .getByRole('link', { name: 'Matter: Ilango v. State (fictional)' })
        .getAttribute('href'),
    ).toBe(`/w/chennai-solo/matters/${MATTER}`);
    expect(within(row).getByText('Confidence 93%')).toBeTruthy();
    expect(within(row).queryByText('sarvam-m')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: en.item.expand }));
    expect(within(row).getByText('sarvam-m')).toBeTruthy();
    expect(within(row).getByText('2026-09')).toBeTruthy();
    expect(within(row).getByText('ap-south-1')).toBeTruthy();
    expect(within(row).getByText(/Asha Rao/)).toBeTruthy();
  });

  it('names its target on Undo, shows the days left, and ends the window with a note', () => {
    const open = activity({ summary: 'Open item' });
    const ended = activity({
      summary: 'Ended item',
      undoable: false,
      createdAt: '2026-10-10T05:00:00.000Z',
      undoExpiresAt: '2026-10-17T05:00:00.000Z',
    });
    view([open, ended]);
    expect(screen.getByRole('button', { name: 'Undo: Open item' })).toBeTruthy();
    expect(within(rowOf('Open item')).getByText('Undo available for 6 more days')).toBeTruthy();
    expect(within(rowOf('Ended item')).getByText(en.item.undoEnded)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo: Ended item' })).toBeNull();
  });

  it('is view only for a viewer: no Undo button, a note instead', () => {
    view([activity({ summary: 'Open item' })], { role: 'viewer', page: { canUndo: false } });
    expect(screen.queryByRole('button', { name: /^Undo:/ })).toBeNull();
    expect(within(rowOf('Open item')).getByText(en.item.viewOnly)).toBeTruthy();
    expect(screen.getByText(en.feed.viewOnly)).toBeTruthy();
  });

  it('shows a redacted row without detail or an expander', () => {
    view([activity({ summary: null, redacted: true, matterId: null, matterTitle: null })]);
    expect(screen.getByText(en.item.redacted)).toBeTruthy();
    expect(screen.getByText(en.item.redactedHint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.item.expand })).toBeNull();
  });

  it('previews the cascade, then undoes, strikes the item through and announces it', async () => {
    const actions = view([activity({ summary: 'Misfiled order' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo: Misfiled order' }));
    const dialog = await screen.findByRole('dialog', { name: en.undoDialog.title });
    await waitFor(() => {
      expect(within(dialog).getByText('Created a task: call the clerk')).toBeTruthy();
    });
    expect(actions.preview).toHaveBeenCalledTimes(1);
    expect(actions.preview.mock.calls[0]?.[0].workspaceId).toBe(WORKSPACE.id);
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: en.undoDialog.confirm }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(actions.undo).toHaveBeenCalledTimes(1);
    const row = rowOf('Misfiled order');
    expect(row.getAttribute('data-undone')).toBe('');
    expect(within(row).getByText(/^Undone by Asha Rao at /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo: Misfiled order' })).toBeNull();
    expect(document.querySelector('[data-slot="activity-live"]')?.textContent).toBe(
      '1 change undone',
    );
  });

  it('shows the engine reason and Open the matter when the engine refuses the undo', async () => {
    const actions = fakeActions();
    actions.undo.mockResolvedValue({
      ok: true,
      data: {
        status: 'refused' as never,
        reason: 'You confirmed or edited this after it was applied, so it can no longer be undone',
        matterId: MATTER,
      } as never,
    });
    view([activity({ summary: 'Confirmed later' })], { actions });
    fireEvent.click(screen.getByRole('button', { name: 'Undo: Confirmed later' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: en.undoDialog.confirm })).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.undoDialog.confirm }));
    expect(await within(dialog).findByText(/no longer be undone/)).toBeTruthy();
    expect(within(dialog).getByText(en.undoDialog.refusedTitle)).toBeTruthy();
    expect(
      within(dialog).getByRole('link', { name: en.undoDialog.openMatter }).getAttribute('href'),
    ).toBe(`/w/chennai-solo/matters/${MATTER}`);
    expect(within(dialog).queryByRole('button', { name: en.undoDialog.confirm })).toBeNull();
  });

  it('shows the reason from the preview when the engine would refuse, and disables Undo', async () => {
    const actions = fakeActions();
    actions.preview.mockImplementation((input) =>
      Promise.resolve({
        ok: true as const,
        data: {
          activityId: input.activityId,
          undoable: false,
          blockedReason: 'The 7-day undo window for this action has closed',
          willRemove: [] as { activityId: string; kind: string; summary: string }[],
          matterId: MATTER,
        },
      }),
    );
    view([activity({ summary: 'Almost out' })], { actions });
    fireEvent.click(screen.getByRole('button', { name: 'Undo: Almost out' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/7-day undo window/)).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: en.undoDialog.confirm })
        .disabled,
    ).toBe(true);
    expect(within(dialog).getByRole('link', { name: en.undoDialog.openMatter })).toBeTruthy();
  });

  it('moves with j and k, opens undo with u, and returns focus to the item', async () => {
    view([activity({ summary: 'First' }), activity({ summary: 'Second' })]);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(document.activeElement).toBe(rowOf('Second'));
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(document.activeElement).toBe(rowOf('First'));
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'u' });
    const dialog = await screen.findByRole('dialog', { name: en.undoDialog.title });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(rowOf('Second'));
    });
  });

  it('expands the focused item with Enter, focuses search with /, lists shortcuts with ?', async () => {
    view([activity({ summary: 'First', model: 'sarvam-m' })]);
    const row = rowOf('First');
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(within(row).getByText('sarvam-m')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: '/' });
    expect((document.activeElement as HTMLElement).getAttribute('type')).toBe('search');
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(await screen.findByRole('dialog', { name: en.shortcuts.title })).toBeTruthy();
  });

  it('does not take keys while typing in a field', () => {
    view([activity({ summary: 'First' }), activity({ summary: 'Second' })]);
    const search = screen.getByRole('searchbox');
    search.focus();
    fireEvent.keyDown(search, { key: 'j' });
    expect(document.activeElement).toBe(search);
  });

  it('writes filters to the URL: the auto-applied preset and clearing', () => {
    view([activity()], { filters: {} });
    fireEvent.click(screen.getByRole('button', { name: en.filters.autoOnly }));
    expect(router.replace).toHaveBeenCalledWith('/w/chennai-solo/activity?level=L3', {
      scroll: false,
    });
    cleanup();
    router.replace.mockClear();
    view([activity()], { filters: { level: 'L3', kind: 'task' } });
    expect(
      screen.getByRole('button', { name: en.filters.autoOnly }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: en.filters.clear }));
    expect(router.replace).toHaveBeenCalledWith('/w/chennai-solo/activity', { scroll: false });
  });

  it('shows the empty state, and a filtered-empty state with Clear filters', () => {
    view([]);
    expect(screen.getByText(en.states.empty)).toBeTruthy();
    cleanup();
    view([], { filters: { level: 'L1' } });
    expect(screen.getByText(en.states.filteredEmpty)).toBeTruthy();
    // The filter panel and the empty state both offer it.
    const clears = screen.getAllByRole('button', { name: en.states.clear });
    expect(clears).toHaveLength(2);
    fireEvent.click(clears[1] as HTMLElement);
    expect(router.replace).toHaveBeenCalledWith('/w/chennai-solo/activity', { scroll: false });
  });

  it('pauses Undo and export offline and says why', () => {
    online = false;
    view([activity({ summary: 'Offline item' })]);
    expect(screen.getByText(en.states.offline)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Undo: Offline item' }).disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.export.button }).disabled).toBe(
      true,
    );
  });

  it('loads the next page by cursor with the current filters and appends it', async () => {
    const actions = view([activity({ summary: 'First' })], {
      filters: { level: 'L3' },
      page: { nextCursor: 'CURSOR' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.feed.loadMore }));
    await waitFor(() => {
      expect(screen.getByText('Loaded later')).toBeTruthy();
    });
    expect(actions.loadMore).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      cursor: 'CURSOR',
      level: 'L3',
    });
    expect(screen.queryByRole('button', { name: en.feed.loadMore })).toBeNull();
  });

  it('offers bulk undo and reassign for one capture', async () => {
    const capture = '00000000-0000-4000-8000-0000000000c1';
    const actions = view([activity({ summary: 'From capture', captureId: capture })], {
      filters: { capture },
    });
    fireEvent.click(screen.getByRole('button', { name: en.item.bulkUndo }));
    const dialog = await screen.findByRole('dialog', { name: en.undoDialog.titleCapture });
    await waitFor(() => {
      expect(within(dialog).getByText('Attached the order')).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.undoDialog.confirmCapture }));
    await waitFor(() => {
      expect(actions.undoCapture).toHaveBeenCalledWith({
        workspaceId: WORKSPACE.id,
        captureId: capture,
      });
    });
    expect(screen.getByRole('button', { name: en.item.reassign })).toBeTruthy();
  });
});
