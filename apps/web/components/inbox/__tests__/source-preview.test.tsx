// @vitest-environment jsdom
// The inbox source preview (#489): the stored page image above the quote, dropped when it fails to
// load, and nothing but the quote when the item has no source. Every text is fictional.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import type { InboxItemView } from '../../../lib/inbox/view.ts';
import { SourcePreview } from '../source-preview.tsx';

const WORKSPACE = '00000000-0000-4000-8000-000000000099';
const DOCUMENT = '00000000-0000-4000-8000-0000000000d1';

const item = (anchors: InboxItemView['anchors']): InboxItemView =>
  ({
    id: 'p1',
    type: 'proposal',
    kind: 'next_date',
    matterId: '00000000-0000-4000-8000-000000000070',
    anchors,
  }) as unknown as InboxItemView;

const anchor = {
  documentId: DOCUMENT,
  page: 3,
  quote: 'Adjourned to 12 November 2026 (fictional)',
  highlight: null,
} as unknown as InboxItemView['anchors'][number];

const renderPreview = (value: InboxItemView) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      <SourcePreview item={value} slug="demo" workspaceId={WORKSPACE} />
    </NextIntlClientProvider>,
  );

afterEach(cleanup);

describe('SourcePreview page image', () => {
  it('shows the stored page image of the anchor, with the quote', () => {
    const { container } = renderPreview(item([anchor]));
    const image = container.querySelector('[data-slot="source-image"]');
    expect(image?.getAttribute('src')).toBe(
      `/api/documents/${DOCUMENT}/pages/3/image?workspaceId=${WORKSPACE}`,
    );
    expect(screen.getByText(/Adjourned to 12 November 2026/)).toBeTruthy();
  });

  it('drops the image when it fails to load and keeps the quote', () => {
    const { container } = renderPreview(item([anchor]));
    const image = container.querySelector('[data-slot="source-image"]');
    if (image === null) throw new Error('image missing');
    fireEvent.error(image);
    expect(container.querySelector('[data-slot="source-image"]')).toBeNull();
    expect(screen.getByText(/Adjourned to 12 November 2026/)).toBeTruthy();
  });

  it('has no image without a source', () => {
    const { container } = renderPreview(item([]));
    expect(container.querySelector('[data-slot="source-image"]')).toBeNull();
  });
});
