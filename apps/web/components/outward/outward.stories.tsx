// Outward drafts (#736): a story per component and per state, with play-function interaction
// tests. Fictional data only; handlers are mocks, so nothing is sent or saved.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { DiffView } from './diff-view.tsx';
import { DraftEditor, type DraftView } from './draft-editor.tsx';
import { DraftList, OutwardStates, type DraftCardView } from './draft-list.tsx';
import { LanguageSwitcher } from './language-switcher.tsx';
import { ShareMenu } from './share-menu.tsx';

const draft: DraftView = {
  id: '00000000-0000-4000-8000-000000000001',
  matterId: '00000000-0000-4000-8000-000000000002',
  matterTitle: 'Meera Rao v. Example Traders (fictional)',
  audience: 'client',
  language: 'en',
  body: 'The matter was adjourned. Next date: 12 Dec 2026.',
  systemBody: 'The matter was adjourned. Next date: to be confirmed.',
  facts: [
    { kind: 'next_date', text: '12 Dec 2026', confirmed: true, source: 'hearing · cause_list' },
    { kind: 'outcome', text: 'Adjourned', confirmed: false, source: 'hearing · manual' },
  ],
  memoryCitations: [
    { key: 'M2.client_update_tone', date: '2026-08-12' },
    { key: 'M6.client_language', date: '2026-09-02' },
  ],
};
const card: DraftCardView = {
  id: draft.id,
  matterTitle: draft.matterTitle,
  audience: 'client',
  language: 'en',
  templateOnly: false,
  createdAt: '2026-11-10T06:00:00.000Z',
  preview: draft.body,
};

const meta = { title: 'Outward/Drafts', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const editorProps = {
  draft,
  offline: false,
  readOnly: false,
  onSave: fn(() => Promise.resolve({ ok: true, warnings: [] })),
  onShared: fn(() => Promise.resolve(true)),
  onLanguageChange: fn(),
  onClose: fn(),
};

export const Editor: Story = {
  render: () => <DraftEditor {...editorProps} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/does not send messages/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /Compare/ }));
    await expect(canvas.getByRole('group', { name: /Changes/ })).toBeVisible();
  },
};
export const EditorOffline: Story = { render: () => <DraftEditor {...editorProps} offline /> };
export const EditorReadOnly: Story = { render: () => <DraftEditor {...editorProps} readOnly /> };
export const List: Story = {
  render: () => (
    <DraftList
      drafts={[card, { ...card, id: 'x', language: 'ta' }]}
      activeId={null}
      onOpen={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('button')).toHaveLength(2);
  },
};
export const Switcher: Story = {
  render: () => <LanguageSwitcher value="en" onChange={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Tamil' }));
  },
};
export const Share: Story = {
  render: () => (
    <ShareMenu
      text={draft.body}
      matterTitle={draft.matterTitle}
      offline={false}
      readOnly={false}
      onShared={fn()}
    />
  ),
};
export const ShareOffline: Story = {
  render: () => (
    <ShareMenu
      text={draft.body}
      matterTitle={draft.matterTitle}
      offline
      readOnly={false}
      onShared={fn()}
    />
  ),
};
export const Diff: Story = {
  render: () => (
    <DiffView
      parts={[
        { op: 'equal', text: 'Next date:' },
        { op: 'delete', text: 'to be confirmed' },
        { op: 'insert', text: '12 Dec 2026' },
      ]}
    />
  ),
};
export const StatesLoading: Story = { render: () => <OutwardStates state="loading" /> };
export const StatesEmpty: Story = { render: () => <OutwardStates state="empty" /> };
export const StatesError: Story = { render: () => <OutwardStates state="error" onRetry={fn()} /> };
export const OfflineState: Story = { render: () => <OutwardStates state="offline" /> };
export const StatesDenied: Story = { render: () => <OutwardStates state="denied" /> };
