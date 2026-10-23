// @vitest-environment jsdom
// The capture inbox shell (#48): three sections with live counts, no "confirm all" for the date-
// critical kinds, page shortcuts that are ignored while typing, decisions switched off offline, a
// 10 s refresh only while something is processing (and not while the tab is hidden), and no copy
// that says the system will send anything. The server actions are mocked; every text is fictional.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import type { InboxItemView, InboxView } from '../../../lib/inbox/view.ts';
import { mockMatchMedia, stubResizeObserver } from '../../shell/__tests__/helpers.tsx';
import { InboxShell } from '../inbox-shell.tsx';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../../app/(app)/w/[slug]/inbox/actions.ts', () => ({
  acceptProposalAction: vi.fn(),
  deleteRecordingAction: vi.fn(),
  dismissProposalAction: vi.fn(),
  editAcceptProposalAction: vi.fn(),
  keepAsAttachmentAction: vi.fn(),
  markSentAction: vi.fn(),
  reassignCaptureAction: vi.fn(),
  typeKeyLineAction: vi.fn(),
  undoActivityAction: vi.fn(),
}));
vi.mock('../../../app/(app)/w/[slug]/matters/actions.ts', () => ({ searchMattersAction: vi.fn() }));

const t = catalogs.en.inbox;
const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const item = (n: number, extra: Partial<InboxItemView> = {}): InboxItemView => ({
  id: ID(n),
  type: 'proposal',
  kind: 'next_date',
  proposalId: ID(n),
  captureId: null,
  matterId: ID(70),
  matterTitle: 'Meera Rao v. Example Traders (fictional)',
  proceedingId: ID(71),
  caseNumber: 'W.P. 12345 of 2026',
  sensitive: false,
  payload: { date: '2026-11-12' },
  currentDate: null,
  confidence: 0.93,
  needsYouReason: null,
  anchors: [],
  createdAt: '2026-11-01T04:00:00.000Z',
  reassignUntil: null,
  canKeep: false,
  ...extra,
});

const view = (overrides: Partial<InboxView> = {}): InboxView => ({
  needsYou: [item(1), item(2, { kind: 'task', payload: { title: 'File the counter' } })],
  ready: [],
  processing: [],
  channels: [
    { channel: 'share', enabled: true },
    { channel: 'voice', enabled: true },
    { channel: 'upload', enabled: true },
  ],
  canAct: true,
  ...overrides,
});

const renderInbox = (value: InboxView) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <InboxShell view={value} workspaceId={ID(99)} slug="demo" />
    </NextIntlClientProvider>,
  );

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

beforeEach(() => {
  mockMatchMedia();
  stubResizeObserver();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setOnline(true);
});

describe('InboxShell', () => {
  it('shows the three sections with their counts', () => {
    renderInbox(
      view({
        processing: [
          {
            captureId: ID(60),
            channel: 'upload',
            status: 'processing',
            createdAt: '2026-11-01T04:00:00.000Z',
            localOnly: false,
          },
        ],
      }),
    );
    const nav = screen.getByRole('navigation', { name: t.sections.label });
    expect(within(nav).getByText(t.sections.needsYou).parentElement?.textContent).toContain('2');
    expect(within(nav).getByText(t.sections.ready).parentElement?.textContent).toContain('0');
    expect(within(nav).getByText(t.sections.processing).parentElement?.textContent).toContain('1');
  });

  it('has no confirm-all action for a list of next dates', () => {
    renderInbox(view({ needsYou: [item(1), item(3), item(4)] }));
    expect(screen.queryByRole('button', { name: /confirm all/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(3);
  });

  it('switches section with 1/2/3, but not while typing in a field', () => {
    renderInbox(view());
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: '2' });
    expect(screen.getAllByRole('button', { name: 'Confirm' }).length).toBeGreaterThan(0);

    fireEvent.keyDown(document.body, { key: '2' });
    expect(screen.getByText(new RegExp(t.empty.ready.title))).toBeTruthy();
    fireEvent.keyDown(document.body, { key: '1' });
    expect(screen.getAllByRole('button', { name: 'Confirm' }).length).toBeGreaterThan(0);
    input.remove();
  });

  it('switches decisions off while offline and says why', () => {
    renderInbox(view());
    setOnline(false);
    expect(screen.getByText(t.offline.banner)).toBeTruthy();
    for (const button of screen.getAllByRole('button', { name: 'Confirm' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('refreshes every 10 s while something is processing, and not otherwise', () => {
    vi.useFakeTimers();
    const processing = {
      captureId: ID(60),
      channel: 'share',
      status: 'queued' as const,
      createdAt: '2026-11-01T04:00:00.000Z',
      localOnly: false,
    };
    const { unmount } = renderInbox(view({ processing: [processing] }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    unmount();

    router.refresh.mockClear();
    renderInbox(view());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('stops refreshing while the tab is hidden', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    renderInbox(
      view({
        processing: [
          {
            captureId: ID(60),
            channel: 'share',
            status: 'queued',
            createdAt: '2026-11-01T04:00:00.000Z',
            localOnly: false,
          },
        ],
      }),
    );
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('shows no actions to a viewer', () => {
    renderInbox(view({ canAct: false }));
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });
});

describe('inbox copy', () => {
  it('never says the system will send anything', () => {
    for (const catalog of [catalogs.en.inbox]) {
      expect(JSON.stringify(catalog)).not.toMatch(
        /\bwe will send\b|\bwill be sent for you\b|will send/i,
      );
    }
  });

  it('has the recovery and empty-state copy of the issue, exactly', () => {
    expect(t.unreadable.copy).toBe(
      "Couldn't read this. Retake, type the key line, or keep as an attachment.",
    );
    expect(`${t.empty.needsYou.title} ${t.empty.needsYou.body}`).toBe(
      'Nothing needs you. Anything unclear will show up here.',
    );
    expect(`${t.empty.ready.title} ${t.empty.ready.body}`).toBe(
      'Nothing waiting to be sent. Drafts you ask for appear here. You always press send yourself.',
    );
    expect(t.offline.banner).toBe(
      "You're offline. Captures are saved on this device and will process when you're back.",
    );
  });
});
