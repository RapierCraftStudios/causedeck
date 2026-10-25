// @vitest-environment jsdom
// The Documents tab (#393, #40 part 5): each document with its kind badge, EN/TA/KN language chip,
// text status, source and version chain, linking to `DocumentPreviewSheet` at a page; `?cursor=`
// pages with "Show older documents"; the Inbox entry point "Share or drop files into your Inbox"
// and an empty state with Open Inbox as its one action; no mutation controls for anyone (viewers
// included); permission-denied without `document.read`; `?doc&page` opens the sheet at a page and
// a document that cannot be shown says so inside the sheet; the tab is registered for members with
// `document.read`; the loading and error screens. Every text is fictional.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentPreview, MatterDocumentPage } from '@causedeck/core/matter-graph';

import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';
import { matterTabs, resetMatterTabs } from '../lib/matters/tab-registry.ts';
import { registerMatterTabs } from '../lib/matters/tabs.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const MATTER_ID = '00000000-0000-4000-8000-000000000001';
const DOC_1 = '00000000-0000-4000-8000-0000000000d1';
const DOC_2 = '00000000-0000-4000-8000-0000000000d2';
const BASE = `/w/demo/matters/${MATTER_ID}/documents`;

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  documents: null as MatterDocumentPage | null,
  preview: null as DocumentPreview | null,
  error: null as Error | null,
  previewError: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const graph = vi.hoisted(() => ({
  listMatterDocuments: vi.fn(() =>
    page.error === null ? Promise.resolve(page.documents) : Promise.reject(page.error),
  ),
  getDocumentPreview: vi.fn(() =>
    page.previewError === null ? Promise.resolve(page.preview) : Promise.reject(page.previewError),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => BASE,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
  getLocale: () => Promise.resolve('en'),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/matter-graph', () => graph);

const { default: DocumentsPage, generateMetadata } =
  await import('../app/(app)/w/[slug]/matters/[id]/documents/page.tsx');
const { default: DocumentsLoading } =
  await import('../app/(app)/w/[slug]/matters/[id]/documents/loading.tsx');
const { default: DocumentsError } =
  await import('../app/(app)/w/[slug]/matters/[id]/documents/error.tsx');

const ws = catalogs.en.matters.workspace;
const docs = ws.documents;
const params = Promise.resolve({ slug: 'demo', id: MATTER_ID });

function documents(): MatterDocumentPage {
  return {
    items: [
      {
        id: DOC_2,
        kind: 'pleading',
        language: 'ta',
        textStatus: 'ocr',
        source: { type: 'capture', captureId: 'c-1' },
        supersedesDocumentId: DOC_1,
        supersededByDocumentId: null,
        createdAt: new Date('2026-10-02T06:00:00Z'),
      },
      {
        id: DOC_1,
        kind: 'pleading',
        language: 'en',
        textStatus: 'layer',
        source: { type: 'manual' },
        supersedesDocumentId: null,
        supersededByDocumentId: DOC_2,
        createdAt: new Date('2026-10-01T06:00:00Z'),
      },
    ],
    nextCursor: 'cursor-2',
  };
}

function preview(overrides: Partial<DocumentPreview> = {}): DocumentPreview {
  return {
    document: {
      id: DOC_1,
      matterId: MATTER_ID,
      kind: 'pleading',
      language: 'en',
      textStatus: 'layer',
      source: { type: 'manual' },
      supersedesDocumentId: null,
      supersededByDocumentId: DOC_2,
      createdAt: new Date('2026-10-01T06:00:00Z'),
    },
    pageCount: 4,
    page: {
      pageNo: 3,
      text: 'Page three (fictional)',
      textSource: 'layer',
      lang: 'en',
      ocrConfidence: null,
    },
    pageImage: null,
    ...overrides,
  };
}

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

async function renderPage(query: Record<string, string> = {}) {
  const content = await DocumentsPage({ params, searchParams: Promise.resolve(query) });
  return withIntl(content);
}

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(readonly code: string) {
    super(code);
  }
}

function as(role: Role) {
  page.context = testWorkspaceContext('demo', role);
}

beforeEach(() => {
  stubResizeObserver();
  mockMatchMedia({ '(min-width: 768px)': true });
  as('owner');
  page.dev = true;
  page.documents = documents();
  page.preview = preview();
  page.error = null;
  page.previewError = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetMatterTabs();
});

describe('Documents tab (#393)', () => {
  it('lists documents with kind, language chip, text status, source, version chain and date', async () => {
    await renderPage();
    const list = screen.getByRole('list', { name: docs.listLabel });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-document'))).toEqual([DOC_2, DOC_1]);
    const newer = rows[0] as HTMLElement;
    expect(newer.querySelector('[data-document-kind="pleading"]')?.textContent).toBe(
      docs.kinds.pleading,
    );
    expect(newer.querySelector('[data-document-language="TA"]')?.textContent).toContain('TA');
    expect(within(newer).getByText(docs.textStatus.ocr)).toBeTruthy();
    expect(within(newer).getByText(docs.sources.capture)).toBeTruthy();
    expect(newer.querySelector(`[data-document-replaces="${DOC_1}"]`)?.getAttribute('href')).toBe(
      `${BASE}?doc=${DOC_1}&page=1`,
    );
    const older = rows[1] as HTMLElement;
    expect(older.querySelector('[data-document-language="EN"]')).not.toBeNull();
    expect(within(older).getByText(docs.sources.manual)).toBeTruthy();
    expect(within(older).getByText(docs.replacedBy)).toBeTruthy();
    // Each row opens the preview at its first page, with an accessible name.
    const open = within(older).getByRole('link', { name: /^Open Pleading, added/ });
    expect(open.getAttribute('href')).toBe(`${BASE}?doc=${DOC_1}&page=1`);
    expect(older.textContent).toMatch(/Added .*2026/);
    expect(graph.listMatterDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ db: { tx: true } }),
      { workspaceId: page.context?.workspace.id, userId: page.context?.user.id },
      { matterId: MATTER_ID, limit: 50 },
    );
  });

  it('points uploads to the Inbox and pages with a cursor', async () => {
    await renderPage();
    const inbox = screen.getByRole('link', { name: docs.inbox });
    expect(inbox.getAttribute('href')).toBe('/w/demo/inbox');
    expect(docs.inbox).toBe('Share or drop files into your Inbox');
    expect(screen.getByRole('link', { name: docs.loadMore }).getAttribute('href')).toBe(
      `${BASE}?cursor=cursor-2`,
    );
    cleanup();
    page.documents = { ...documents(), nextCursor: null };
    await renderPage({ cursor: 'cursor-2' });
    expect(graph.listMatterDocuments).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      {
        matterId: MATTER_ID,
        limit: 50,
        cursor: 'cursor-2',
      },
    );
    expect(screen.queryByRole('link', { name: docs.loadMore })).toBeNull();
    expect(screen.getByRole('link', { name: docs.newest }).getAttribute('href')).toBe(BASE);
  });

  it('marks the populated list with [data-documents="list"], never "empty"', async () => {
    await renderPage();
    const list = document.querySelector('[data-documents]') as HTMLElement;
    expect(list.getAttribute('data-documents')).toBe('list');
    expect(list.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-documents="empty"]')).toBeNull();
  });

  it('has an empty state with Open Inbox as its one action', async () => {
    page.documents = { items: [], nextCursor: null };
    await renderPage();
    const empty = document.querySelector('[data-documents="empty"]') as HTMLElement;
    expect(within(empty).getByText(docs.inbox)).toBeTruthy();
    const actions = within(empty).getAllByRole('link');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.textContent).toBe(docs.openInbox);
    expect(actions[0]?.getAttribute('href')).toBe('/w/demo/inbox');
  });

  it.each(['owner', 'viewer'] as const)('has no mutation controls for a %s', async (role) => {
    as(role);
    await renderPage();
    expect(document.querySelectorAll('[data-document]').length).toBe(2);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('opens the preview sheet at the asked page', async () => {
    await renderPage({ doc: DOC_1, page: '3' });
    expect(graph.getDocumentPreview).toHaveBeenCalledWith(
      expect.objectContaining({ db: { tx: true } }),
      expect.anything(),
      { documentId: DOC_1, pageNo: 3 },
    );
    const sheet = document.querySelector('[data-slot="document-preview-sheet"]') as HTMLElement;
    expect(within(sheet).getByText('Page 3 of 4')).toBeTruthy();
    expect(within(sheet).getByText('Page three (fictional)')).toBeTruthy();
    expect(within(sheet).getByText(docs.preview.imagePending)).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: docs.preview.next }).getAttribute('href')).toBe(
      `${BASE}?doc=${DOC_1}&page=4`,
    );
    fireEvent.click(within(sheet).getByRole('button', { name: docs.preview.close }));
    expect(router.push).toHaveBeenCalledWith(BASE, { scroll: false });
  });

  it('treats a bad page as page 1', async () => {
    for (const bad of ['0', '-2', 'abc', '1.5']) {
      await renderPage({ doc: DOC_1, page: bad });
      expect(graph.getDocumentPreview).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        { documentId: DOC_1, pageNo: 1 },
      );
      cleanup();
    }
  });

  it('says a document is not available without saying whether it exists', async () => {
    page.previewError = new WorkspaceError('NOT_FOUND');
    await renderPage({ doc: DOC_1 });
    expect(document.querySelector('[data-preview="unavailable"]')?.textContent).toBe(
      docs.preview.unavailable,
    );
    // The list still renders behind it.
    expect(document.querySelectorAll('[data-document]').length).toBe(2);
    cleanup();
    // A document of another matter is not previewed on this matter's tab.
    page.previewError = null;
    page.preview = preview({
      document: { ...preview().document, matterId: '00000000-0000-4000-8000-0000000000ff' },
    });
    await renderPage({ doc: DOC_1 });
    expect(document.querySelector('[data-preview="unavailable"]')).not.toBeNull();
    expect(screen.queryByText('Page three (fictional)')).toBeNull();
  });

  it('is a not-found for another workspace or an unknown matter', async () => {
    page.error = new WorkspaceError('NOT_FOUND');
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows permission-denied without document.read and throws to the boundary on errors', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    await renderPage();
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    page.error = new Error('db down');
    await expect(renderPage()).rejects.toThrow('Matter documents could not be loaded');
    expect(logger.error).toHaveBeenCalledWith({ err: page.error }, expect.any(String));
  });

  it('previews the states in development only', async () => {
    await renderPage({ __state: 'empty' });
    expect(document.querySelector('[data-documents="empty"]')).not.toBeNull();
    cleanup();
    await renderPage({ __state: 'denied' });
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    await expect(renderPage({ __state: 'error' })).rejects.toThrow();
    page.dev = false;
    await renderPage({ __state: 'empty' });
    expect(document.querySelector('[data-documents="empty"]')).toBeNull();
  });

  it('names the page and has loading and error screens', async () => {
    expect(await generateMetadata()).toEqual({ title: ws.tabs.documents });
    withIntl(<DocumentsLoading />);
    expect(document.querySelector('[data-slot="documents-skeleton"]')).not.toBeNull();
    cleanup();
    const reset = vi.fn();
    const error = Object.assign(new Error('secret text'), { digest: 'ref-9' });
    withIntl(<DocumentsError error={error} reset={reset} />);
    expect(screen.getByText(docs.error.title)).toBeTruthy();
    expect(screen.getByText('Reference: ref-9')).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret text');
    fireEvent.click(screen.getByRole('button', { name: docs.error.retry }));
    expect(reset).toHaveBeenCalled();
  });

  it('is registered after People for every role with document.read', () => {
    registerMatterTabs();
    for (const role of ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const) {
      const ids = matterTabs(role).map((tab) => tab.id);
      expect(ids.indexOf('documents'), role).toBeGreaterThan(ids.indexOf('people'));
    }
    expect(matterTabs('owner').find((tab) => tab.id === 'documents')).toMatchObject({
      segment: 'documents',
      labelKey: 'documents',
      order: 30,
    });
  });
});
