/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
// @vitest-environment jsdom
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../../../../../../components/shell/__tests__/helpers.tsx';

import { OutcomeForm } from './outcome-form.tsx';

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'acme' }) }));
vi.mock('../../../../../../../../lib/offline/use-outbox.ts', () => ({
  useOfflineEdits: () => ({ enqueue: vi.fn(), stuck: [], resolve: vi.fn() }),
}));
vi.mock('../actions.ts', () => ({
  confirmOutcomeAction: vi.fn(),
  recordManualOutcomeAction: vi.fn(),
}));
vi.mock('../../../../_pov/preparedness-tap.tsx', () => ({
  PreparednessTap: () => <div data-testid="preparedness-tap" />,
}));

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

afterEach(() => {
  cleanup();
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
