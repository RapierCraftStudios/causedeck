// @vitest-environment jsdom
// Matter workspace components (#390): the Next-date card's `Confirm` calls the action and
// announces the change in the polite live region; the Conflict card is a labelled region whose
// Choose A / Choose B / Enter manually call `chooseNextDateSourceAction` with `current`,
// `proposed` or `manual` and the typed date; the synopsis editor saves and clears; the sensitive
// toggle shows the exact CA-10 explanation, changes nothing on Cancel and returns focus to the menu
// button; offline turns every mutation off; the tab bar moves focus with the arrow keys.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DateConflictCard } from '../components/matters/date-conflict-card.tsx';
import { MatterAnnouncer } from '../components/matters/matter-announcer.tsx';
import { MatterTabs } from '../components/matters/matter-tab-bar.tsx';
import { NextDateCard } from '../components/matters/next-date-card.tsx';
import { SensitiveDialog } from '../components/matters/sensitive-toggle.tsx';
import { SynopsisEditor } from '../components/matters/synopsis-editor.tsx';
import type { ConflictView, ListingView } from '../lib/matters/workspace.ts';
import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';

import { catalogs } from './helpers/intl.ts';

const WS = 'ws-1';
const MATTER = 'm-1';
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/w/demo/matters/m-1',
}));

const ws = catalogs.en.matters.workspace;

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <MatterAnnouncer>{ui}</MatterAnnouncer>
    </NextIntlClientProvider>,
  );

const announcer = () => document.querySelector('[data-matter-announcer]') as HTMLElement;

function view(overrides: Partial<ListingView> = {}): ListingView {
  return {
    listingId: 'l-current',
    proceedingId: 'p-1',
    date: '2099-11-14',
    text: 'Sat, 14 Nov 2099',
    relative: 'in 73 years',
    proposed: false,
    stage: null,
    source: { kind: 'adapter', state: 'confirmed', sourceRef: 'list', confidence: null },
    ...overrides,
  };
}

const conflict: ConflictView = {
  proceedingId: 'p-1',
  current: view(),
  proposed: view({
    listingId: 'l-proposed',
    date: '2099-11-21',
    text: 'Sat, 21 Nov 2099',
    proposed: true,
    source: { kind: 'ai', state: 'proposed', sourceRef: 'order', confidence: 0.8 },
  }),
  others: [],
};

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

beforeEach(() => {
  stubResizeObserver();
  mockMatchMedia({ '(hover: hover) and (pointer: fine)': true });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NextDateCard (#390)', () => {
  it('confirms a proposed date and announces it', async () => {
    const action = vi.fn(() =>
      ok({ listingId: 'l-current', date: '2099-11-14', confirmationState: 'confirmed' }),
    );
    withIntl(
      <NextDateCard
        workspaceId={WS}
        nextDate={view({ proposed: true })}
        canWrite
        action={action}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: ws.nextDate.confirm }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(ws.nextDate.announceConfirmed);
    });
    expect(action).toHaveBeenCalledWith({ workspaceId: WS, listingId: 'l-current' });
    expect(router.refresh).toHaveBeenCalled();
    expect(announcer().getAttribute('role')).toBe('status');
  });

  it('shows an error and keeps the date when confirming fails; offline it is off', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'CONFLICT' as const, message: '' } }),
    );
    withIntl(
      <NextDateCard
        workspaceId={WS}
        nextDate={view({ proposed: true })}
        canWrite
        action={action}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: ws.nextDate.confirm }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
    cleanup();
    withIntl(
      <NextDateCard
        workspaceId={WS}
        nextDate={view({ proposed: true })}
        canWrite
        offline
        action={action}
      />,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: ws.nextDate.confirm }).disabled,
    ).toBe(true);
  });
});

describe('confidence chip and N-source conflict (#499)', () => {
  it('shows the confidence chip with the sources on hover', () => {
    withIntl(
      <NextDateCard
        workspaceId={WS}
        nextDate={view({
          dateAgreement: {
            status: 'agree',
            percent: 90,
            sources: [
              { kind: 'adapter', ref: 'list', value: '2099-11-14' },
              { kind: 'import', ref: null, value: '2099-11-14' },
            ],
          },
        })}
        canWrite
        action={vi.fn()}
      />,
    );
    const chip = document.querySelector('[data-confidence-chip="date"]') as HTMLElement;
    expect(chip.textContent).toBe('Confidence 90%');
    expect(chip.getAttribute('title')).toContain(ws.source.adapter);
    expect(chip.getAttribute('title')).toContain(ws.source.import);
  });

  it('offers a third source as its own side, chosen against A', async () => {
    const action = vi.fn(() =>
      ok({ listingId: 'l', date: '2099-11-14', confirmationState: 'confirmed' }),
    );
    const third = view({ listingId: 'l-third', text: 'Mon, 23 Nov 2099', proposed: true });
    withIntl(
      <DateConflictCard
        workspaceId={WS}
        conflict={{ ...conflict, others: [third] }}
        canWrite
        action={action}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose C' }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({
        workspaceId: WS,
        currentListingId: 'l-current',
        proposedListingId: 'l-third',
        choice: 'proposed',
      });
    });
  });
});

describe('DateConflictCard (#390)', () => {
  it.each([
    ['A', ws.conflict.chooseA, 'current'],
    ['B', ws.conflict.chooseB, 'proposed'],
  ] as const)('Choose %s sends %s', async (_side, label, choice) => {
    const action = vi.fn(() =>
      ok({ listingId: 'l', date: '2099-11-14', confirmationState: 'confirmed' }),
    );
    withIntl(<DateConflictCard workspaceId={WS} conflict={conflict} canWrite action={action} />);
    const card = screen.getByRole('region', { name: ws.conflict.title });
    fireEvent.click(within(card).getByRole('button', { name: label }));
    await waitFor(() => {
      expect(announcer().textContent).toContain('Next date set to');
    });
    expect(action).toHaveBeenCalledWith({
      workspaceId: WS,
      currentListingId: 'l-current',
      proposedListingId: 'l-proposed',
      choice,
    });
  });

  it('Enter manually sends the typed date and refuses an empty one', async () => {
    const action = vi.fn(() =>
      ok({ listingId: 'l-new', date: '2099-12-01', confirmationState: 'confirmed' }),
    );
    withIntl(<DateConflictCard workspaceId={WS} conflict={conflict} canWrite action={action} />);
    fireEvent.click(screen.getByRole('button', { name: ws.conflict.manual }));
    fireEvent.click(screen.getByRole('button', { name: ws.conflict.save }));
    expect(await screen.findByText(ws.conflict.dateRequired)).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
    const input = document.querySelector('[data-conflict-date]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2099-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: ws.conflict.save }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({
        workspaceId: WS,
        currentListingId: 'l-current',
        proposedListingId: 'l-proposed',
        choice: 'manual',
        date: '2099-12-01',
      });
    });
  });

  it('says so when the card was already resolved, and is off while offline', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'CONFLICT' as const, message: '' } }),
    );
    withIntl(<DateConflictCard workspaceId={WS} conflict={conflict} canWrite action={action} />);
    fireEvent.click(screen.getByRole('button', { name: ws.conflict.chooseA }));
    expect(await screen.findByText(ws.conflict.stale)).toBeTruthy();
    cleanup();
    withIntl(
      <DateConflictCard workspaceId={WS} conflict={conflict} canWrite offline action={action} />,
    );
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-conflict-choose], [data-conflict-manual]',
    )) {
      expect(button.disabled).toBe(true);
    }
  });
});

describe('SynopsisEditor (#390)', () => {
  const action = vi.fn((input: { patch: { synopsis?: string | null } }) =>
    ok({ id: MATTER, title: 'T', synopsis: input.patch.synopsis ?? null }),
  );

  it('edits, saves and announces; an empty note clears it', async () => {
    withIntl(
      <SynopsisEditor
        workspaceId={WS}
        matterId={MATTER}
        synopsis="Old note"
        denied={false}
        canWrite
        action={action}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: ws.synopsis.edit }));
    const box = screen.getByRole('textbox', { name: ws.synopsis.label });
    fireEvent.change(box, { target: { value: '  New note ' } });
    fireEvent.click(screen.getByRole('button', { name: ws.synopsis.save }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(ws.synopsis.announceSaved);
    });
    expect(action).toHaveBeenLastCalledWith({
      workspaceId: WS,
      matterId: MATTER,
      patch: { synopsis: 'New note' },
    });
    fireEvent.click(screen.getByRole('button', { name: ws.synopsis.edit }));
    fireEvent.change(screen.getByRole('textbox', { name: ws.synopsis.label }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: ws.synopsis.save }));
    await waitFor(() => {
      expect(action).toHaveBeenLastCalledWith({
        workspaceId: WS,
        matterId: MATTER,
        patch: { synopsis: null },
      });
    });
  });

  it('offers Write synopsis on an empty note, nothing to readers, and is off offline', () => {
    withIntl(
      <SynopsisEditor
        workspaceId={WS}
        matterId={MATTER}
        synopsis={null}
        denied={false}
        canWrite
        action={action}
      />,
    );
    expect(screen.getByText(ws.synopsis.empty)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ws.synopsis.write }));
    expect(screen.getByRole('textbox', { name: ws.synopsis.label })).toBeTruthy();
    cleanup();
    withIntl(
      <SynopsisEditor
        workspaceId={WS}
        matterId={MATTER}
        synopsis="Note"
        denied={false}
        canWrite={false}
        action={action}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    withIntl(
      <SynopsisEditor
        workspaceId={WS}
        matterId={MATTER}
        synopsis="Note"
        denied={false}
        canWrite
        offline
        action={action}
      />,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: ws.synopsis.edit }).disabled).toBe(
      true,
    );
  });
});

describe('SensitiveDialog (#390)', () => {
  function Harness({
    action,
    sensitive = false,
    offline = false,
  }: {
    action: Parameters<typeof SensitiveDialog>[0]['action'];
    sensitive?: boolean;
    offline?: boolean;
  }) {
    return (
      <>
        <button type="button" data-testid="invoker">
          menu
        </button>
        <SensitiveDialog
          workspaceId={WS}
          matterId={MATTER}
          sensitive={sensitive}
          action={action}
          open
          onOpenChange={onOpenChange}
          offline={offline}
          returnFocus={() => screen.getByTestId('invoker')}
        />
      </>
    );
  }
  const onOpenChange = vi.fn();

  it('explains CA-10 and changes nothing on Cancel', () => {
    const action = vi.fn(() => ok({ id: MATTER, sensitive: true }));
    withIntl(<Harness action={action} />);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(ws.menu.markTitle)).toBeTruthy();
    expect(
      within(dialog).getByText(
        'AI processing is turned off for this matter and it is excluded from bulk imports and shared briefs',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: ws.menu.cancel }));
    expect(action).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('marks the matter on confirmation and announces it', async () => {
    const action = vi.fn(() => ok({ id: MATTER, sensitive: true }));
    withIntl(<Harness action={action} />);
    fireEvent.click(screen.getByRole('button', { name: ws.menu.confirmMark }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(ws.menu.announceOn);
    });
    expect(action).toHaveBeenCalledWith({ workspaceId: WS, matterId: MATTER, sensitive: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('removes the mark with its own wording; offline confirming is off', () => {
    const action = vi.fn(() => ok({ id: MATTER, sensitive: false }));
    withIntl(<Harness action={action} sensitive offline />);
    expect(screen.getByText(ws.menu.removeTitle)).toBeTruthy();
    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: ws.menu.confirmRemove,
    });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(ws.offlineAction)).toBeTruthy();
  });

  it('returns focus to the menu button when it closes', async () => {
    const action = vi.fn(() => ok({ id: MATTER, sensitive: true }));
    const view = withIntl(<Harness action={action} />);
    view.rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
        <MatterAnnouncer>
          <button type="button" data-testid="invoker">
            menu
          </button>
          <SensitiveDialog
            workspaceId={WS}
            matterId={MATTER}
            sensitive={false}
            action={action}
            open={false}
            onOpenChange={onOpenChange}
            returnFocus={() => screen.getByTestId('invoker')}
          />
        </MatterAnnouncer>
      </NextIntlClientProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('invoker'));
    });
  });
});

describe('MatterTabs (#390)', () => {
  it('is a tablist with a roving tabindex; arrows, Home and End move focus', () => {
    withIntl(
      <MatterTabs
        label={ws.tabListLabel}
        entries={[
          { id: 'overview', href: '/w/demo/matters/m-1', label: 'Overview' },
          { id: 'proceedings', href: '/w/demo/matters/m-1/proceedings', label: 'Proceedings' },
          { id: 'people', href: '/w/demo/matters/m-1/people', label: 'People' },
        ]}
      >
        <p>content</p>
      </MatterTabs>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2] as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(screen.getByRole('tabpanel').textContent).toBe('content');
  });
});
