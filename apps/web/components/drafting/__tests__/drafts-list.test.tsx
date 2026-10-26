// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DraftRowView } from '../../../lib/drafting/list.ts';
import { parseMatterParam } from '../../../lib/drafting/list.ts';
import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { DraftsList } from '../drafts-list.tsx';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
});

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const row: DraftRowView = {
  id: ID(10),
  href: `/w/chambers/drafts/${ID(10)}`,
  title: 'Mention memo',
  matterId: ID(20),
  matterTitle: 'Rao v. Traders (fictional)',
  templateName: 'Mention memo (Madras HC)',
  updatedAt: '2026-11-03T05:30:00.000Z',
  citations: { verified: 3, not_found: 1, unknown: 2 },
  consistency: { error: 1, warn: 0, info: 0 },
};

const base = {
  workspaceId: ID(1),
  slug: 'chambers',
  rows: [row],
  matters: [{ id: ID(20), title: 'Rao v. Traders (fictional)' }],
  matterFilter: null,
  templates: [{ id: ID(30), name: 'Mention memo (Madras HC)' }],
};

describe('DraftsList (#826)', () => {
  it('shows title, matter, template, last edited and text-labelled chips', () => {
    const { container } = renderWithIntl(<DraftsList {...base} createAction={vi.fn()} />);
    const el = container.querySelector(`[data-drafts-row="${ID(10)}"]`);
    expect(el?.textContent).toContain('Mention memo');
    expect(el?.textContent).toContain('Rao v. Traders (fictional)');
    expect(el?.textContent).toContain('Mention memo (Madras HC)');
    expect(el?.textContent).toContain('3 verified');
    expect(el?.textContent).toContain('1 not found');
    expect(el?.textContent).toContain('2 unknown');
    expect(el?.textContent).toContain('1 error');
    expect(screen.getByRole('link', { name: /Open draft Mention memo/ }).getAttribute('href')).toBe(
      row.href,
    );
  });

  it('says consistency was not checked when there is no report', () => {
    renderWithIntl(
      <DraftsList {...base} rows={[{ ...row, consistency: null }]} createAction={vi.fn()} />,
    );
    expect(screen.getByText('Consistency not checked')).toBeTruthy();
  });

  it('shows the empty state', () => {
    const { container } = renderWithIntl(<DraftsList {...base} rows={[]} createAction={vi.fn()} />);
    expect(container.querySelector('[data-drafts-empty="empty"]')).not.toBeNull();
  });

  it('shows the filtered-empty state', () => {
    const { container } = renderWithIntl(
      <DraftsList {...base} rows={[]} matterFilter={ID(20)} createAction={vi.fn()} />,
    );
    expect(container.querySelector('[data-drafts-empty="filtered"]')).not.toBeNull();
  });

  it('the matter filter navigates with ?matter=', () => {
    renderWithIntl(<DraftsList {...base} createAction={vi.fn()} />);
    fireEvent.change(document.querySelector('[data-drafts-filter="matter"]') as Element, {
      target: { value: ID(20) },
    });
    expect(push).toHaveBeenCalledWith(`/w/chambers/drafts?matter=${ID(20)}`);
  });

  it('creating a draft calls the action and opens the new draft', async () => {
    const createAction = vi.fn(() => Promise.resolve({ ok: true as const, data: { id: ID(40) } }));
    renderWithIntl(<DraftsList {...base} createAction={createAction} initialPickerOpen />);
    fireEvent.change(screen.getByLabelText(/Draft title/), { target: { value: ' My draft ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => {
      expect(createAction).toHaveBeenCalledWith({
        workspaceId: ID(1),
        templateId: ID(30),
        matterId: null,
        title: 'My draft',
      });
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/w/chambers/drafts/${ID(40)}`);
    });
  });

  it('shows a forbidden failure and does not navigate', async () => {
    const createAction = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'FORBIDDEN' as const, message: '' } }),
    );
    renderWithIntl(<DraftsList {...base} createAction={createAction} initialPickerOpen />);
    fireEvent.change(screen.getByLabelText(/Draft title/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot create drafts');
    expect(push).not.toHaveBeenCalled();
  });

  it('offline: the banner shows and New draft is off', () => {
    const { container } = renderWithIntl(
      <DraftsList {...base} createAction={vi.fn()} forceOffline />,
    );
    expect(container.querySelector('[data-drafts-offline]')).not.toBeNull();
    expect(
      (container.querySelector('[data-drafts-action="new"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('read-only members get no New draft button', () => {
    const { container } = renderWithIntl(
      <DraftsList {...base} createAction={vi.fn()} canCreate={false} />,
    );
    expect(container.querySelector('[data-drafts-action="new"]')).toBeNull();
  });
});

describe('parseMatterParam', () => {
  it('keeps a UUID and ignores anything else', () => {
    expect(parseMatterParam(ID(20))).toBe(ID(20));
    expect(parseMatterParam([ID(20), 'x'])).toBe(ID(20));
    expect(parseMatterParam('not-a-uuid')).toBeNull();
    expect(parseMatterParam(undefined)).toBeNull();
  });
});
