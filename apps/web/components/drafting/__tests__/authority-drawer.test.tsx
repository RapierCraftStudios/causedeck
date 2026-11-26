// @vitest-environment jsdom
// The studio's authority drawer (#1144): no question until the member asks; loading, "no authority
// found", AI off for a sensitive matter, a failed call with retry; candidates with their pinpoint and
// corpus link; Insert sends the candidate ref unaltered after the selected block and reports the new
// version; a stale version reads as a conflict.
import type { Block } from '@causedeck/validators/drafting';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import {
  AuthorityDrawer,
  AuthorityDrawerPanel,
  type AuthorityCandidateView,
  type AuthorityInsert,
  type AuthorityPropose,
} from '../authority-drawer.tsx';

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'demo' }) }));

afterEach(cleanup);

const en = catalogs.en.drafting.authorityDrawer;
const JUDGMENT = '00000000-0000-4000-8000-0000000e0001';

const candidate: AuthorityCandidateView = {
  candidateRef: { judgmentId: JUDGMENT, quote: 'no written consent was taken', para: 12 },
  title: 'Rao v. Nursing Home',
  neutralCitation: '2019:MHC:99999',
  court: 'MHC',
  sourceUrl: 'https://court.example/j1.pdf',
  page: 4,
  paragraph: 12,
};

const blocks: Block[] = [
  { type: 'heading', level: 1, text: 'Submissions' },
  { type: 'paragraph', text: 'Consent was never obtained.' },
] as Block[];

describe('AuthorityDrawer', () => {
  it('shows each state with its own copy', () => {
    const props = { candidates: [], hasBlock: true, onPropose: vi.fn(), onInsert: vi.fn() };
    const view = (ui: Parameters<typeof renderWithIntl>[0]) => {
      cleanup();
      return renderWithIntl(ui).container;
    };
    view(<AuthorityDrawer {...props} status="loading" />);
    expect(screen.getByRole('status').textContent).toBe(en.loading);
    expect(
      view(<AuthorityDrawer {...props} status="ready" />).querySelector(
        '[data-slot="authority-empty"]',
      )?.textContent,
    ).toBe(en.empty);
    expect(
      view(<AuthorityDrawer {...props} status="aiBlocked" />).querySelector(
        '[data-slot="authority-ai-blocked"]',
      )?.textContent,
    ).toBe(en.aiBlocked);
    view(<AuthorityDrawer {...props} status="error" />);
    expect(screen.getByRole('alert').textContent).toContain(en.error);
    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    expect(props.onPropose).toHaveBeenCalledTimes(1);
    view(<AuthorityDrawer {...props} hasBlock={false} status="idle" />);
    expect(screen.getByText(en.noBlock)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.find })).toBeNull();
  });

  it('lists a candidate with its pinpoint, quote and corpus link', () => {
    const { container } = renderWithIntl(
      <AuthorityDrawer
        status="ready"
        candidates={[candidate]}
        hasBlock
        onPropose={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    const item = container.querySelector('[data-slot="authority-candidate"]');
    expect(item?.textContent).toContain('Rao v. Nursing Home');
    expect(item?.textContent).toContain('para 12');
    expect(item?.textContent).toContain('no written consent was taken');
    // #1191: the in-app reader at the pinpoint, never the stored source URL.
    expect(
      Array.from(item?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href')),
    ).toEqual([`/w/demo/research/judgments/${JUDGMENT}?page=4&para=12#cited`]);
  });

  it('holds Insert while there are unsaved edits', () => {
    renderWithIntl(
      <AuthorityDrawer
        status="ready"
        candidates={[candidate]}
        hasBlock
        unsaved
        onPropose={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    expect(screen.getByText(en.saveFirst)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.insert }).hasAttribute('disabled')).toBe(true);
  });
});

describe('AuthorityDrawerPanel', () => {
  const panel = (propose: AuthorityPropose, insert: AuthorityInsert, onInserted = vi.fn()) =>
    renderWithIntl(
      <AuthorityDrawerPanel
        workspaceId="ws"
        draftId="d1"
        versionId="v1"
        blocks={blocks}
        selectedBlock="b.1"
        online
        propose={propose}
        insert={insert}
        onInserted={onInserted}
      />,
    );

  it('asks only on click, then inserts the candidate ref unaltered after the block', async () => {
    const propose = vi.fn<AuthorityPropose>().mockResolvedValue({
      ok: true,
      data: { candidates: [candidate], noAuthority: false, aiBlocked: false },
    });
    const insert = vi.fn<AuthorityInsert>().mockResolvedValue({
      ok: true,
      data: { versionId: 'v2', versionNo: 2, blockId: 'auth-1' },
    });
    const onInserted = vi.fn();
    panel(propose, insert, onInserted);
    expect(propose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.find }));
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws', draftId: 'd1', blockId: 'b.1' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: en.insert }));
    await waitFor(() => {
      expect(onInserted).toHaveBeenCalledWith({ versionId: 'v2', versionNo: 2, blockId: 'auth-1' });
    });
    expect(insert).toHaveBeenCalledWith({
      workspaceId: 'ws',
      draftId: 'd1',
      versionId: 'v1',
      afterBlockId: 'b.1',
      candidateRef: candidate.candidateRef,
    });
    expect(insert.mock.calls[0]?.[0].candidateRef).toBe(candidate.candidateRef);
  });

  it('says no authority found when nothing verified', async () => {
    const propose = vi.fn<AuthorityPropose>().mockResolvedValue({
      ok: true,
      data: { candidates: [], noAuthority: true, aiBlocked: false },
    });
    const { container } = panel(propose, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: en.find }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="authority-empty"]')?.textContent).toBe(en.empty);
    });
  });

  it('says AI is off for a sensitive matter', async () => {
    const propose = vi.fn<AuthorityPropose>().mockResolvedValue({
      ok: true,
      data: { candidates: [], noAuthority: false, aiBlocked: true },
    });
    const { container } = panel(propose, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: en.find }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="authority-ai-blocked"]')).not.toBeNull();
    });
  });

  it('shows a failed call as an error, and a stale insert as a conflict', async () => {
    const propose = vi
      .fn<AuthorityPropose>()
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: '' } })
      .mockResolvedValueOnce({
        ok: true,
        data: { candidates: [candidate], noAuthority: false, aiBlocked: false },
      });
    const insert = vi
      .fn<AuthorityInsert>()
      .mockResolvedValue({ ok: false, error: { code: 'CONFLICT', message: '' } });
    const onInserted = vi.fn();
    panel(propose, insert, onInserted);
    fireEvent.click(screen.getByRole('button', { name: en.find }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(en.error);
    });
    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    fireEvent.click(await screen.findByRole('button', { name: en.insert }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.insertConflict);
    });
    expect(onInserted).not.toHaveBeenCalled();
  });
});
