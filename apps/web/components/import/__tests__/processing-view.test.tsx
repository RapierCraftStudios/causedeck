// @vitest-environment jsdom
// The states of the bootstrap import progress (#552), including the free-plan cap message.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import type { ImportProgressView } from '../../../app/(app)/w/[slug]/import/actions.ts';
import { ProcessingView } from '../processing-view.tsx';

const progress = (over: Partial<ImportProgressView> = {}): ImportProgressView => ({
  batchId: 'b',
  status: 'processing',
  total: 4,
  files: { pending: 1, processing: 0, parsed: 2, unmatched: 0, failed: 1 },
  matchedRows: 0,
  keptAsAttachments: 0,
  needsIdentifiers: false,
  ...over,
});

const show = (view: ImportProgressView, onReview?: () => void) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      <ProcessingView
        progress={view}
        retrying={false}
        onRetryFailed={vi.fn()}
        onReview={onReview}
      />
    </NextIntlClientProvider>,
  );

describe('ProcessingView', () => {
  afterEach(cleanup);

  it('shows per-file progress and a retry for failed files', () => {
    show(progress());
    expect(screen.getByText('3 of 4 files read')).toBeTruthy();
    expect(screen.getByText('1 file could not be read.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry the failed files' })).toBeTruthy();
  });

  it('says so when nothing was recognised', () => {
    show(progress({ status: 'ready', files: { ...progress().files, failed: 0 } }));
    expect(screen.getByText(/Nothing recognised/)).toBeTruthy();
  });

  it('words the free-plan cap exactly', () => {
    show(progress({ keptAsAttachments: 3 }));
    expect(
      screen.getByText(
        'Import limit reached for this plan. 3 files were kept as attachments without reading.',
      ),
    ).toBeTruthy();
  });

  it('offers the plan once it is ready', () => {
    const onReview = vi.fn();
    show(
      progress({ status: 'ready', matchedRows: 5, files: { ...progress().files, failed: 0 } }),
      onReview,
    );
    screen.getByRole('button', { name: 'Review the plan' }).click();
    expect(onReview).toHaveBeenCalledOnce();
  });
});
