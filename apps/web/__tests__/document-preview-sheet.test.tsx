// @vitest-environment jsdom
// `DocumentPreviewSheet` (#393): exported for the timeline (#41) and later screens, plain data in
// and string hrefs out. It shows `Page n of m` with Previous/Next links built from the page href
// prefix, the page's extracted text with its `lang`, a neutral "Page image not ready yet" until the
// document pipeline (#45) renders page images and an <img> once there is one, "Text not extracted
// yet" for a page without text, "No pages yet" for a document without pages, and an unavailable or
// failed state without saying whether the document exists. Close goes to the close href. The
// preview view mapper picks EN/TA/KN chips and the text's language. Every text is fictional.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentPreview } from '@causedeck/core/matter-graph';

import * as sheetModule from '../components/matters/document-preview-sheet.tsx';
import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';
import { documentPreviewHref, documentPreviewHrefPrefix } from '../lib/matters/documents-tab.ts';
import {
  languageChip,
  toDocumentPreviewView,
  type DocumentPreviewView,
} from '../lib/matters/documents.ts';

import { catalogs } from './helpers/intl.ts';

const { DocumentPreviewSheet } = sheetModule;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../src/health.ts', () => ({ logger: { error: vi.fn() } }));

const docs = catalogs.en.matters.workspace.documents;
const PREFIX = '/w/demo/matters/m-1/documents?doc=d-1&page=';

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

function view(overrides: Partial<DocumentPreviewView> = {}): DocumentPreviewView {
  return {
    document: {
      id: 'd-1',
      matterId: 'm-1',
      kind: 'order',
      language: 'TA',
      textStatus: 'ocr',
      source: 'capture',
      supersedesDocumentId: null,
      supersededByDocumentId: null,
      added: '01 Oct 2026',
    },
    pageCount: 3,
    page: { pageNo: 2, text: 'இரண்டாம் பக்கம்\nSecond line (fictional)', lang: 'ta' },
    pageImage: null,
    ...overrides,
  };
}

beforeEach(() => {
  stubResizeObserver();
  mockMatchMedia({ '(min-width: 768px)': true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DocumentPreviewSheet (#393)', () => {
  it('is a named export other screens can use', () => {
    expect(typeof sheetModule.DocumentPreviewSheet).toBe('function');
  });

  it('shows the page, its text with lang, and Previous/Next links', () => {
    withIntl(
      <DocumentPreviewSheet
        state={{ kind: 'preview', preview: view() }}
        pageHrefPrefix={PREFIX}
        closeHref="/w/demo/matters/m-1/documents"
      />,
    );
    const sheet = document.querySelector('[data-slot="document-preview-sheet"]') as HTMLElement;
    expect(within(sheet).getByRole('heading', { name: 'Order, added 01 Oct 2026' })).toBeTruthy();
    expect(within(sheet).getByText('Page 2 of 3')).toBeTruthy();
    expect(
      within(sheet).getByRole('link', { name: docs.preview.previous }).getAttribute('href'),
    ).toBe(`${PREFIX}1`);
    expect(within(sheet).getByRole('link', { name: docs.preview.next }).getAttribute('href')).toBe(
      `${PREFIX}3`,
    );
    const text = sheet.querySelector('[data-preview-text]') as HTMLElement;
    expect(text.getAttribute('lang')).toBe('ta');
    expect(text.textContent).toBe('இரண்டாம் பக்கம்\nSecond line (fictional)');
    expect(sheet.querySelector('[data-preview-image="pending"]')?.textContent).toContain(
      docs.preview.imagePending,
    );
    expect(sheet.querySelector('img')).toBeNull();
  });

  it('jumps to a typed page within the document', () => {
    withIntl(
      <DocumentPreviewSheet
        state={{ kind: 'preview', preview: view() }}
        pageHrefPrefix={PREFIX}
        closeHref="/x"
      />,
    );
    const input = screen.getByLabelText(docs.preview.goTo);
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: docs.preview.go }));
    expect(router.push).toHaveBeenCalledWith(`${PREFIX}3`);
  });

  it('renders the page image once there is one, and no Previous on the first page', () => {
    withIntl(
      <DocumentPreviewSheet
        state={{
          kind: 'preview',
          preview: view({
            page: { pageNo: 1, text: 'Page one', lang: undefined },
            pageImage: { url: 'https://storage.example.test/p1.webp' },
          }),
        }}
        pageHrefPrefix={PREFIX}
        closeHref="/x"
      />,
    );
    const img = screen.getByRole('img', { name: 'Page 1' });
    expect(img.getAttribute('src')).toBe('https://storage.example.test/p1.webp');
    expect(screen.queryByRole('link', { name: docs.preview.previous })).toBeNull();
  });

  it('says when a page has no text yet, or the document no pages yet', () => {
    withIntl(
      <DocumentPreviewSheet
        state={{
          kind: 'preview',
          preview: view({ page: { pageNo: 1, text: null, lang: undefined } }),
        }}
        pageHrefPrefix={PREFIX}
        closeHref="/x"
      />,
    );
    expect(screen.getByText(docs.preview.textPending)).toBeTruthy();
    cleanup();
    withIntl(
      <DocumentPreviewSheet
        state={{ kind: 'preview', preview: view({ page: null, pageCount: 0 }) }}
        pageHrefPrefix={PREFIX}
        closeHref="/x"
      />,
    );
    expect(screen.getByText(docs.preview.noPages)).toBeTruthy();
  });

  it('shows unavailable and failed states and closes to the close href', () => {
    withIntl(
      <DocumentPreviewSheet
        state={{ kind: 'unavailable' }}
        pageHrefPrefix={PREFIX}
        closeHref="/back"
      />,
    );
    expect(document.querySelector('[data-preview="unavailable"]')?.textContent).toBe(
      docs.preview.unavailable,
    );
    fireEvent.click(screen.getByRole('button', { name: docs.preview.close }));
    expect(router.push).toHaveBeenCalledWith('/back', { scroll: false });
    cleanup();
    withIntl(
      <DocumentPreviewSheet state={{ kind: 'error' }} pageHrefPrefix={PREFIX} closeHref="/x" />,
    );
    expect(screen.getByText(docs.preview.failed)).toBeTruthy();
  });
});

describe('document preview view and hrefs (#393)', () => {
  it('maps the read model: EN/TA/KN chip, text lang, formatted date', () => {
    const preview: DocumentPreview = {
      document: {
        id: 'd-1',
        matterId: 'm-1',
        kind: 'judgment',
        language: 'kn-IN',
        textStatus: 'layer',
        source: { type: 'manual' },
        supersedesDocumentId: 'd-0',
        supersededByDocumentId: null,
        createdAt: new Date('2026-10-01T06:00:00Z'),
      },
      pageCount: 2,
      page: { pageNo: 1, text: 'ಪುಟ', textSource: 'layer', lang: null, ocrConfidence: null },
      pageImage: null,
    };
    const mapped = toDocumentPreviewView(preview, 'en');
    expect(mapped.document).toMatchObject({
      language: 'KN',
      source: 'manual',
      supersedesDocumentId: 'd-0',
      matterId: 'm-1',
    });
    expect(mapped.document.added).toMatch(/2026/);
    expect(mapped.page).toEqual({ pageNo: 1, text: 'ಪುಟ', lang: 'kn' });
    expect([
      languageChip('en'),
      languageChip('ta'),
      languageChip('hi'),
      languageChip(null),
    ]).toEqual(['EN', 'TA', null, null]);
  });

  it('builds preview hrefs at a page', () => {
    expect(documentPreviewHrefPrefix('my ws', 'm-1', 'd 1')).toBe(
      '/w/my%20ws/matters/m-1/documents?doc=d%201&page=',
    );
    expect(documentPreviewHref('demo', 'm-1', 'd-1', 4)).toBe(
      '/w/demo/matters/m-1/documents?doc=d-1&page=4',
    );
    expect(documentPreviewHref('demo', 'm-1', 'd-1', 0)).toBe(
      '/w/demo/matters/m-1/documents?doc=d-1&page=1',
    );
  });
});
