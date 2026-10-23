import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../components/shell/__tests__/helpers.tsx';

const search = vi.hoisted(() => vi.fn());

vi.mock('../app/(app)/w/[slug]/matters/actions.ts', () => ({ searchMattersAction: search }));

const { RecordingReview } = await import('../components/capture/voice/recording-review.tsx');

afterEach(() => {
  cleanup();
  search.mockReset();
});

describe('recording review matter picker', () => {
  it('lets a recording opened without a matter pick one', async () => {
    search.mockResolvedValue({
      ok: true,
      data: [{ id: 'm-1', title: 'Rao v. Rao', forum: null, nextDate: null }],
    });
    const onPickMatter = vi.fn();
    renderWithIntl(
      <RecordingReview
        url="blob:x"
        durationMs={12_000}
        workspaceId="ws-1"
        onPickMatter={onPickMatter}
        onClearMatter={vi.fn()}
        busy={false}
        onAgain={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Link to a matter (optional)'), {
      target: { value: 'rao' },
    });
    const option = await waitFor(() => screen.getByRole('button', { name: 'Rao v. Rao' }));
    fireEvent.click(option);
    expect(search).toHaveBeenCalledWith({ workspaceId: 'ws-1', q: 'rao' });
    expect(onPickMatter).toHaveBeenCalledWith({ id: 'm-1', title: 'Rao v. Rao' });
  });
});
