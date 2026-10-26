// @vitest-environment jsdom
// The carry suggestion row (#74, R1/D22): a remembered rule not yet taken up shows the citation
// chip, Add / Not now buttons with 44px targets, and the a / x keys.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from './helpers/intl.ts';

const setCarryItemAction = vi.fn<(input: unknown) => Promise<{ ok: boolean }>>(() =>
  Promise.resolve({ ok: true }),
);
vi.mock('../app/(app)/w/[slug]/briefs/[listing-id]/actions.ts', () => ({
  setCarryItemAction: (input: unknown) => setCarryItemAction(input),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'acme' }) }));
vi.mock('../lib/offline/use-outbox.ts', () => ({
  useOfflineEdits: () => ({ enqueue: vi.fn(() => Promise.resolve(true)) }),
}));

import { CarrySection } from '../app/(app)/w/[slug]/briefs/[listing-id]/_sheet/carry-section.tsx';

const LISTING = '00000000-0000-4000-8000-000000000003';
const items = [
  {
    key: 'rule:r1',
    kind: 'rule' as const,
    label: 'vakalat copy',
    document_id: null,
    ticked: false,
  },
  { key: 'manual:m1', kind: 'manual' as const, label: 'pen', document_id: null, ticked: false },
];

const mount = (canWrite = true) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      <CarrySection
        workspaceId="00000000-0000-4000-8000-000000000001"
        listingId={LISTING}
        items={items}
        reviewed={false}
        canWrite={canWrite}
        offline={false}
      />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  setCarryItemAction.mockClear();
});
afterEach(cleanup);

describe('carry suggestion row', () => {
  it('shows the chip, Add and Not now with 44px targets', () => {
    mount();
    const row = document.querySelector('[data-carry-suggestion="rule:r1"]');
    expect(row).not.toBeNull();
    expect(screen.getByRole('note', { name: /because you usually carry this/i })).toBeTruthy();
    for (const name of [/Add vakalat copy to the carry list/, /Not now: vakalat copy/]) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-11');
    }
  });

  it('Add keeps the rule item ticked on the list', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Add vakalat copy/ }));
    await waitFor(() => {
      expect(setCarryItemAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tick', key: 'rule:r1', ticked: true }),
      );
    });
    expect(document.querySelector('[data-carry-suggestion]')).toBeNull();
  });

  it('x is Not now: the suggestion is removed, which the memory domain learns from', async () => {
    mount();
    const row = document.querySelector<HTMLElement>('[data-carry-suggestion="rule:r1"]');
    fireEvent.keyDown(row as HTMLElement, { key: 'x' });
    await waitFor(() => {
      expect(setCarryItemAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'remove', key: 'rule:r1' }),
      );
    });
    expect(screen.queryByText('vakalat copy')).toBeNull();
  });

  it('a adds the first suggestion when the list has focus', async () => {
    mount();
    const list = document.querySelector<HTMLElement>('[data-carry-list]');
    fireEvent.keyDown(list as HTMLElement, { key: 'a' });
    await waitFor(() => {
      expect(setCarryItemAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tick', key: 'rule:r1', ticked: true }),
      );
    });
  });

  it('typing a or x in the add field does not act on a suggestion', () => {
    mount();
    fireEvent.keyDown(screen.getByLabelText(catalogs.en.brief.carry.addLabel), { key: 'a' });
    expect(setCarryItemAction).not.toHaveBeenCalled();
  });

  it('shows no suggestion row without write access', () => {
    mount(false);
    expect(document.querySelector('[data-carry-suggestion]')).toBeNull();
  });
});
