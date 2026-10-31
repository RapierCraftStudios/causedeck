/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
// @vitest-environment jsdom
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../../../../../../components/shell/__tests__/helpers.tsx';

import { OutcomeForm } from './outcome-form.tsx';

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'acme' }) }));
vi.mock('../../../../../../../../lib/offline/use-outbox.ts', () => ({
  useOfflineEdits: () => ({ enqueue: vi.fn(), stuck: [], resolve: vi.fn() }),
}));
const queueOutcomeConfirm = vi.fn(() => Promise.resolve());
const flushOutcomeConfirms = vi.fn(() => Promise.resolve({ sent: 0, conflicts: 0, failed: 0 }));
vi.mock('../../../../../../../../lib/pwa/outbox/outcome-confirms.ts', () => ({
  browserOutcomeConfirmStores: () => Promise.resolve({ store: {}, keys: {} }),
  queueOutcomeConfirm: (...args: unknown[]) =>
    (queueOutcomeConfirm as (...a: unknown[]) => unknown)(...args),
  flushOutcomeConfirms: (...args: unknown[]) =>
    (flushOutcomeConfirms as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../actions.ts', () => ({
  confirmOutcomeAction: vi.fn(),
  recordManualOutcomeAction: vi.fn(),
}));
vi.mock('../../../../_pov/preparedness-tap.tsx', () => ({
  PreparednessTap: () => <div data-testid="preparedness-tap" />,
}));

const setItem = vi.fn();
const removeItem = vi.fn();
let stored: string | null = null;

beforeEach(() => {
  stored = null;
  queueOutcomeConfirm.mockClear();
  flushOutcomeConfirms.mockClear();
  setItem.mockClear();
  removeItem.mockClear();
  vi.stubGlobal('localStorage', { getItem: () => stored, setItem, removeItem });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const UUID = '00000000-0000-4000-8000-000000000001';
const proposal = (confirmed: boolean): OutcomeProposal => ({
  hearingId: UUID,
  matterId: UUID,
  proceedingId: UUID,
  heldOn: '2026-11-03',
  state: 'ready',
  conflict: null,
  obligations: [],
  tasks: [],
  transcriptRef: null,
  language: 'en',
  confirmed,
});

const renderForm = (confirmed: boolean, askPreparedness: boolean) =>
  renderWithIntl(
    <OutcomeForm
      workspaceId={UUID}
      proposal={proposal(confirmed)}
      owners={[]}
      excerpts={[]}
      canWrite
      hearingId={UUID}
      askPreparedness={askPreparedness}
    />,
  );

describe('OutcomeForm preparedness tap (#970)', () => {
  it('shows no tap after a confirmed outcome when the server said not to prompt', () => {
    renderForm(true, false);
    expect(screen.queryByTestId('preparedness-tap')).toBeNull();
  });

  it('shows the tap after a confirmed outcome when the server said to prompt', () => {
    renderForm(true, true);
    expect(screen.getByTestId('preparedness-tap')).toBeTruthy();
  });

  it('shows no tap before the outcome is confirmed', () => {
    renderForm(false, true);
    expect(screen.queryByTestId('preparedness-tap')).toBeNull();
  });
});

describe('OutcomeForm offline confirm queue (#730)', () => {
  const goOffline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

  it('queues a confirm made offline in the sealed store, never in localStorage', async () => {
    goOffline();
    renderForm(false, false);
    fireEvent.change(screen.getByLabelText('What happened'), {
      target: { value: 'Adjourned for arguments' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'No next date / disposed' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm outcome' }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queueOutcomeConfirm).toHaveBeenCalledTimes(1);
    });
    const call = queueOutcomeConfirm.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { workspaceId: string; hearingId: string; payload: { outcome: string } },
    ];
    expect(call[2].hearingId).toBe(UUID);
    expect(call[2].payload.outcome).toBe('Adjourned for arguments');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('moves a decision an older build left in localStorage into the sealed queue and wipes it', async () => {
    stored = JSON.stringify({ summary: 'old plaintext' });
    renderForm(false, false);
    await waitFor(() => {
      expect(removeItem).toHaveBeenCalledWith(`outcome-queue:${UUID}`);
    });
    const call = queueOutcomeConfirm.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { payload: { summary: string } },
    ];
    expect(call[2].payload.summary).toBe('old plaintext');
  });

  it('replays the sealed queue for this hearing when online', async () => {
    renderForm(false, false);
    await waitFor(() => {
      expect(flushOutcomeConfirms).toHaveBeenCalled();
    });
    const args = flushOutcomeConfirms.mock.calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
      { workspaceId: string; hearingId: string },
    ];
    expect(args[3]).toEqual({ workspaceId: UUID, hearingId: UUID });
  });
});
