// @vitest-environment jsdom
// The stepper opens the confirm grid itself (#553): a resumed batch (`?batch=<id>`) that is ready
// shows its review button, and the button loads the stored plan into the grid. With `onPlanReady`
// the host takes over instead and the grid is not mounted.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';

import { PLAN } from './fixtures.ts';

const BATCH = '6f1c1c0e-5d0e-4a39-9a55-2f3c1b7a9d11';

const state = vi.hoisted(() => ({ search: '' }));
const actions = vi.hoisted(() => ({
  importProgressAction: vi.fn(),
  getImportPlanAction: vi.fn(),
  buildImportPlanAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/import',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('../../../app/(app)/w/[slug]/inbox/actions.ts', () => ({ enableChannelAction: vi.fn() }));
vi.mock('../../../app/(app)/w/[slug]/import/actions.ts', () => ({
  ...actions,
  addImportFilesAction: vi.fn(),
  applyImportPlanAction: vi.fn(),
  saveImportPlanEditsAction: vi.fn(),
  startImportBatchAction: vi.fn(),
  undoImportBatchAction: vi.fn(),
}));

const { mockMatchMedia, stubResizeObserver } = await import('../../shell/__tests__/helpers.tsx');
const { BootstrapImport } = await import('../bootstrap-import.tsx');

const ready = {
  batchId: BATCH,
  status: 'ready',
  total: 2,
  files: { pending: 0, processing: 0, parsed: 2, unmatched: 0, failed: 0 },
  matchedRows: 4,
  keptAsAttachments: 0,
  needsIdentifiers: false,
};

const show = (onPlanReady?: (id: string) => void) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      <BootstrapImport
        workspaceId="w"
        channelEnabled
        canEnableChannel
        disclosureVersion="v"
        onPlanReady={onPlanReady}
      />
    </NextIntlClientProvider>,
  );

describe('BootstrapImport review', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the confirm grid from a resumed ready batch', async () => {
    state.search = `batch=${BATCH}`;
    mockMatchMedia();
    stubResizeObserver();
    Element.prototype.scrollIntoView = vi.fn();
    actions.importProgressAction.mockResolvedValue({ ok: true, data: ready });
    actions.getImportPlanAction.mockResolvedValue({ ok: true, data: PLAN });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review the plan' }));
    expect(await screen.findByDisplayValue('Clash v State')).toBeTruthy();
    expect(actions.getImportPlanAction).toHaveBeenCalledWith({ workspaceId: 'w', batchId: BATCH });
  });

  it('hands over to onPlanReady without loading the plan', async () => {
    state.search = `batch=${BATCH}`;
    actions.importProgressAction.mockResolvedValue({ ok: true, data: ready });
    const onPlanReady = vi.fn();
    show(onPlanReady);
    fireEvent.click(await screen.findByRole('button', { name: 'Review the plan' }));
    await waitFor(() => {
      expect(onPlanReady).toHaveBeenCalledWith(BATCH);
    });
    expect(actions.getImportPlanAction).not.toHaveBeenCalled();
  });

  it('plans a resumed batch that was never planned, once (handed over from the inbox, #1073)', async () => {
    state.search = `batch=${BATCH}`;
    actions.importProgressAction.mockResolvedValue({
      ok: true,
      data: { ...ready, status: 'pending', files: { ...ready.files, pending: 1, parsed: 0 } },
    });
    actions.buildImportPlanAction.mockResolvedValue({ ok: true, data: { status: 'processing' } });
    show();
    await waitFor(() => {
      expect(actions.buildImportPlanAction).toHaveBeenCalledWith({
        workspaceId: 'w',
        batchId: BATCH,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(actions.buildImportPlanAction).toHaveBeenCalledTimes(1);
  });

  it('asks for the identifiers of a handed-over batch when none are saved', async () => {
    state.search = `batch=${BATCH}`;
    actions.importProgressAction.mockResolvedValue({
      ok: true,
      data: { ...ready, status: 'pending', needsIdentifiers: true },
    });
    actions.buildImportPlanAction.mockResolvedValue({
      ok: true,
      data: { status: 'needs_identifiers' },
    });
    show();
    await waitFor(() => {
      expect(actions.buildImportPlanAction).toHaveBeenCalled();
    });
    expect(await screen.findByLabelText(/enrolment/i)).toBeTruthy();
  });

  it('does not plan a resumed batch that is already read', async () => {
    state.search = `batch=${BATCH}`;
    actions.importProgressAction.mockResolvedValue({ ok: true, data: ready });
    show();
    await screen.findByRole('button', { name: 'Review the plan' });
    expect(actions.buildImportPlanAction).not.toHaveBeenCalled();
  });

  it('ignores a malformed batch id', () => {
    state.search = 'batch=nope';
    show();
    expect(actions.importProgressAction).not.toHaveBeenCalled();
  });
});
