// @vitest-environment jsdom
// The matters list's client half (#388): `j`/`k` move the active row and focus its link, `Enter`
// opens it, `n` opens New matter for writers who are online (never while typing, never for
// viewers, never on `Shift+N`, the shell's notifications key). The search field is the page search
// `/` focuses; filters rewrite the URL and drop the cursor. New matter submits through its action,
// shows field errors, and Esc returns focus to the invoker.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatterFilters, SEARCH_DEBOUNCE_MS } from '../components/matters/matter-filters.tsx';
import { MattersList, loadNewMatterDialog } from '../components/matters/matters-list.tsx';
import type { CreateMatterAction } from '../components/matters/new-matter-dialog.tsx';
import type { MatterRowView } from '../lib/matters/graph-deps.ts';
import { parseMatterListState, type MatterListState } from '../lib/matters/list-params.ts';
import { PAGE_SEARCH_SELECTOR } from '../lib/shortcuts/provider.tsx';

import { catalogs } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@causedeck/ui/sonner', () => ({ toast: vi.fn() }));

const en = catalogs.en.matters;
const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';
const FORUM_ID = '00000000-0000-4000-8000-0000000000f1';

function view(n: number): MatterRowView {
  return {
    id: `m${String(n)}`,
    href: `/w/demo/matters/m${String(n)}`,
    title: `Matter ${String(n)}`,
    sensitive: false,
    petitioner: 'K. Rao',
    respondent: 'State',
    forum: 'Madras High Court',
    stage: 'listed',
    proceedingCount: 1,
    nextDate: { text: 'Sat, 14 Nov 2026', relative: 'in 23 days', confirmed: true },
    owner: 'Asha Rao',
    updated: '20 Oct 2026',
    updatedAt: '2026-10-20T06:30:00.000Z',
  };
}

const ROWS = [view(1), view(2), view(3)];

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

const createAction = vi.fn<CreateMatterAction>(() =>
  Promise.resolve({ ok: true, data: { id: 'm9', title: 'New one' } }),
);

function list({
  canWrite = true,
  state = parseMatterListState({}),
  openNew = false,
  extra,
}: {
  canWrite?: boolean;
  state?: MatterListState;
  openNew?: boolean;
  extra?: ReactNode;
} = {}) {
  return withIntl(
    <>
      <MattersList
        rows={ROWS}
        state={state}
        slug="demo"
        workspaceId="ws-1"
        canWrite={canWrite}
        openNew={openNew}
        createAction={createAction}
        header={<h1>{en.title}</h1>}
        toolbar={
          <MatterFilters
            state={state}
            slug="demo"
            owners={[{ id: OWNER_ID, name: 'Asha Rao' }]}
            forums={[{ id: FORUM_ID, name: 'Madras High Court, Chennai' }]}
          />
        }
      />
      {extra}
    </>,
  );
}

const key = (k: string, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...init });
};

const rowLink = (n: number) =>
  document.querySelector<HTMLElement>(
    `[data-matters-layout="table"] [data-matter-row="m${String(n)}"] [data-matter-link]`,
  );

// Radix's checkbox measures itself; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // jsdom does not scroll.
  Element.prototype.scrollIntoView = vi.fn();
  setOnline(true);
  // The dialog chunk, loaded once up front so opening it is synchronous in these tests.
  await loadNewMatterDialog();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('matters list keyboard (#388)', () => {
  it('j and k move the active row and focus its link; Enter on the page opens it', () => {
    list();
    key('j');
    expect(document.activeElement).toBe(rowLink(1));
    key('j');
    key('j');
    key('j');
    expect(document.activeElement).toBe(rowLink(3));
    expect(rowLink(3)?.closest('tr')?.getAttribute('aria-selected')).toBe('true');
    key('k');
    expect(document.activeElement).toBe(rowLink(2));
    (document.activeElement as HTMLElement).blur();
    key('Enter');
    expect(router.push).toHaveBeenCalledWith('/w/demo/matters/m2');
  });

  it('leaves Enter on a focused link to the link', () => {
    list();
    key('j');
    key('Enter');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ignores the keys while typing in the search field', () => {
    list();
    const search = screen.getByRole('searchbox', { name: en.search.label });
    search.focus();
    key('j');
    key('n');
    expect(document.activeElement).toBe(search);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('n opens New matter for a writer, and Esc returns focus to where it was', async () => {
    list();
    key('j');
    const invoker = document.activeElement;
    key('n');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en.new.title);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(invoker);
  });

  it('n does nothing for a viewer, with Shift held, or offline', () => {
    list({ canWrite: false });
    expect(screen.queryByRole('button', { name: en.new.trigger })).toBeNull();
    key('n');
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    list();
    key('N', { shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      setOnline(false);
    });
    key('n');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: en.new.trigger })).toHaveProperty('disabled', true);
  });

  it('opens New matter on load for ?new=1', async () => {
    list({ openNew: true });
    expect((await screen.findByRole('dialog')).textContent).toContain(en.new.title);
  });
});

describe('matter filters (#388)', () => {
  it('marks the search as the page search for the shell’s `/`', () => {
    list();
    expect(document.querySelector(PAGE_SEARCH_SELECTOR)).toBe(
      screen.getByRole('searchbox', { name: en.search.label }),
    );
  });

  it('rewrites the URL for each filter, dropping the cursor', () => {
    list({ state: parseMatterListState({ cursor: 'k1', sort: 'title' }) });
    const inline = document.querySelector('[data-matter-filters="inline"]') as HTMLElement;
    const select = (name: string) =>
      inline.querySelector(`[data-matter-filter="${name}"]`) as HTMLSelectElement;
    fireEvent.change(select('status'), { target: { value: 'disposed' } });
    expect(router.replace).toHaveBeenLastCalledWith('/w/demo/matters?status=disposed&sort=title', {
      scroll: false,
    });
    fireEvent.change(select('forum'), { target: { value: FORUM_ID } });
    expect(router.replace).toHaveBeenLastCalledWith(
      `/w/demo/matters?forum=${FORUM_ID}&sort=title`,
      { scroll: false },
    );
    fireEvent.change(select('owner'), { target: { value: OWNER_ID } });
    expect(router.replace).toHaveBeenLastCalledWith(
      `/w/demo/matters?owner=${OWNER_ID}&sort=title`,
      { scroll: false },
    );
    fireEvent.click(select('noNextDate'));
    expect(router.replace).toHaveBeenLastCalledWith('/w/demo/matters?noNextDate=1&sort=title', {
      scroll: false,
    });
    fireEvent.click(select('sensitive'));
    expect(router.replace).toHaveBeenLastCalledWith('/w/demo/matters?sensitive=1&sort=title', {
      scroll: false,
    });
    fireEvent.change(select('sort'), { target: { value: 'next_date' } });
    expect(router.replace).toHaveBeenLastCalledWith('/w/demo/matters', { scroll: false });
  });

  it('applies the search after typing pauses, or on Enter', () => {
    vi.useFakeTimers();
    list();
    const search = screen.getByRole('searchbox', { name: en.search.label });
    fireEvent.change(search, { target: { value: 'wp 45/26' } });
    expect(router.replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(router.replace).toHaveBeenCalledWith('/w/demo/matters?q=wp+45%2F26', { scroll: false });
    router.replace.mockClear();
    fireEvent.change(search, { target: { value: 'Rao' } });
    fireEvent.submit(search.closest('form') as HTMLFormElement);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/w/demo/matters?q=Rao', { scroll: false });
  });

  it('clears every filter but keeps the sort', () => {
    list({ state: parseMatterListState({ status: 'active', q: 'Rao', sort: 'updated' }) });
    const inline = document.querySelector('[data-matter-filters="inline"]') as HTMLElement;
    fireEvent.click(inline.querySelector('[data-slot="clear-filters"]') as HTMLElement);
    expect(router.replace).toHaveBeenCalledWith('/w/demo/matters?sort=updated', { scroll: false });
  });
});

describe('new matter dialog (#388)', () => {
  async function openDialog() {
    fireEvent.click(screen.getByRole('button', { name: en.new.trigger }));
    return screen.findByRole('dialog');
  }

  it('asks for a title, then creates the matter, refreshes and closes', async () => {
    list();
    const dialog = await openDialog();
    expect(dialog.textContent).toContain(en.new.sensitiveHint);
    fireEvent.click(screen.getByRole('button', { name: en.new.submit }));
    expect(await screen.findByText(en.new.errors.required)).toBeTruthy();
    expect(createAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(en.new.titleLabel) }), {
      target: { value: '  Rao v. State  ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: en.new.sensitive }));
    fireEvent.click(screen.getByRole('button', { name: en.new.submit }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(createAction).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      title: 'Rao v. State',
      sensitive: true,
    });
    expect(router.refresh).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.new.trigger }));
  });

  it('shows a forbidden answer from the server and stays open', async () => {
    createAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'no' },
    });
    list();
    await openDialog();
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(en.new.titleLabel) }), {
      target: { value: 'Rao v. State' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.new.submit }));
    expect(await screen.findByText(en.new.errors.forbidden)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
