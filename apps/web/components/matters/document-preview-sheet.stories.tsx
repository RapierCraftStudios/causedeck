// The document preview sheet (#393): one page of a document, the image beside its text, with
// Previous/Next. Tamil and Kannada pages carry their `lang` for shaping and the screen-reader voice.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen } from 'storybook/test';

import type { DocumentPreviewView } from '../../lib/matters/documents.ts';

import { DocumentPreviewSheet } from './document-preview-sheet.tsx';

const preview = (overrides: Partial<DocumentPreviewView> = {}): DocumentPreviewView => ({
  document: {
    id: 'd-2',
    matterId: 'm-1',
    kind: 'order',
    language: 'EN',
    textStatus: 'layer',
    source: 'manual',
    supersedesDocumentId: null,
    supersededByDocumentId: null,
    added: '12 Oct 2026',
  },
  pageCount: 3,
  page: { pageNo: 2, text: 'The petition is admitted.\nList after four weeks.', lang: 'en' },
  pageImage: null,
  ...overrides,
});

const meta = {
  title: 'Matters/DocumentPreviewSheet',
  component: DocumentPreviewSheet,
  args: {
    state: { kind: 'preview', preview: preview() },
    pageHrefPrefix: '/w/demo/matters/m-1/documents?preview=d-2&page=',
    closeHref: '/w/demo/matters/m-1/documents',
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DocumentPreviewSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Page: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await expect(screen.getByText('Page image not ready yet')).toBeVisible();
  },
};

export const PageImage: Story = {
  args: {
    state: {
      kind: 'preview',
      preview: preview({ pageImage: { url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } }),
    },
  },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};

export const TextPending: Story = {
  args: {
    state: {
      kind: 'preview',
      preview: preview({ page: { pageNo: 1, text: null, lang: undefined } }),
    },
  },
  play: async () => {
    await expect(await screen.findByText('Text not extracted yet')).toBeVisible();
  },
};

export const NoPages: Story = {
  args: { state: { kind: 'preview', preview: preview({ pageCount: 0, page: null }) } },
  play: async () => {
    await expect(await screen.findByText('No pages yet')).toBeVisible();
  },
};

export const Unavailable: Story = {
  args: { state: { kind: 'unavailable' } },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};

export const ErrorState: Story = {
  args: { state: { kind: 'error' } },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};

export const Tamil: Story = {
  args: {
    state: {
      kind: 'preview',
      preview: preview({
        document: { ...preview().document, language: 'TA' },
        page: {
          pageNo: 1,
          text: 'மனு ஏற்கப்பட்டது.\nநான்கு வாரங்களுக்குப் பிறகு பட்டியலிடவும்.',
          lang: 'ta',
        },
      }),
    },
  },
  globals: { locale: 'ta' },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};

export const Kannada: Story = {
  args: {
    state: {
      kind: 'preview',
      preview: preview({
        document: { ...preview().document, language: 'KN' },
        page: {
          pageNo: 1,
          text: 'ಅರ್ಜಿಯನ್ನು ಸ್ವೀಕರಿಸಲಾಗಿದೆ.\nನಾಲ್ಕು ವಾರಗಳ ನಂತರ ಪಟ್ಟಿ ಮಾಡಿ.',
          lang: 'kn',
        },
      }),
    },
  },
  globals: { locale: 'kn' },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};
