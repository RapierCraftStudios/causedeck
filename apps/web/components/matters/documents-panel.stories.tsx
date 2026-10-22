// The Documents tab (#393): the matter's documents, newest first, with kind, language, text status,
// source and the version chain. No upload or edit controls: viewers see what writers see.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import type { DocumentRowView } from '../../lib/matters/documents.ts';

import { DocumentsPanel } from './documents-panel.tsx';

const doc = (
  overrides: Partial<DocumentRowView> & Pick<DocumentRowView, 'id'>,
): DocumentRowView => ({
  kind: 'order',
  language: 'EN',
  textStatus: 'layer',
  source: 'capture',
  supersedesDocumentId: null,
  supersededByDocumentId: null,
  added: '12 Oct 2026',
  ...overrides,
});

const documents: DocumentRowView[] = [
  doc({
    id: 'd-3',
    kind: 'judgment',
    language: 'TA',
    textStatus: 'ocr',
    supersedesDocumentId: 'd-2',
  }),
  doc({ id: 'd-2', kind: 'order', supersededByDocumentId: 'd-3', source: 'manual' }),
  doc({ id: 'd-1', kind: 'pleading', language: 'KN', textStatus: 'pending', added: '3 Oct 2026' }),
  doc({ id: 'd-0', kind: 'note', language: null, textStatus: 'skipped', added: '1 Oct 2026' }),
];

const meta = {
  title: 'Matters/DocumentsPanel',
  component: DocumentsPanel,
  args: {
    slug: 'demo',
    matterId: 'm-1',
    list: { documents, nextCursor: null },
    inboxHref: '/w/demo/inbox',
    moreHref: null,
    firstHref: null,
  },
} satisfies Meta<typeof DocumentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem').length).toBeGreaterThanOrEqual(documents.length);
    await expect(canvas.getByRole('link', { name: /Open Judgment/ })).toBeVisible();
  },
};

export const LaterPage: Story = {
  args: {
    list: { documents, nextCursor: 'next' },
    moreHref: '/w/demo/matters/m-1/documents?cursor=next',
    firstHref: '/w/demo/matters/m-1/documents',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Show older documents' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Back to the newest' })).toBeVisible();
  },
};

export const Empty: Story = {
  args: { list: { documents: [], nextCursor: null } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Open Inbox' })).toHaveAttribute(
      'href',
      '/w/demo/inbox',
    );
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
