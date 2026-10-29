// The drafting studio's parts (#827): the block-tree editor, the facts panel and the version drawer.
import type { Block } from '@causedeck/validators/drafting';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { DraftEditor } from './editor.tsx';
import { FactsPanel, type DraftFact } from './facts-panel.tsx';
import { DraftStudio } from '../../app/(app)/w/[slug]/drafts/[id]/studio.tsx';
import { VersionDrawer } from './version-drawer.tsx';

const BLOCKS: Block[] = [
  { type: 'heading', id: 'h', level: 1, text: 'Writ petition' },
  { type: 'paragraph', text: 'The petitioner states that the case is [[missing: matter.cnr]].' },
  { type: 'slot', id: 'cnr', resolver: 'matter.cnr' },
  { type: 'narrative', id: 'n', prompt: 'Summarise the facts', maxChars: 500 },
];

const FACTS: DraftFact[] = [
  {
    id: 'cnr',
    label: 'CNR',
    value: 'KAHC010012342025',
    source: { kind: 'system', label: 'eCourts', state: 'confirmed' },
  },
];

const frame = (Story: () => React.ReactNode) => (
  <div className="bg-surface text-ink max-w-3xl p-4">
    <Story />
  </div>
);

const meta = {
  title: 'Drafting/Studio parts',
  component: DraftEditor,
  decorators: [frame],
  args: {
    blocks: BLOCKS,
    slotValues: { cnr: '[[missing: matter.cnr]]' },
    aiTexts: { n: 'Model-drafted summary of the facts.' },
    onChange: fn(),
    onSelectSlot: fn(),
  },
} satisfies Meta<typeof DraftEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DraftEditorBlocks: Story = {};

export const DraftEditorReadOnlyOffline: Story = { args: { readOnly: true } };

export const DraftFactsPanel: Story = {
  render: () => <FactsPanel facts={FACTS} selectedSlot="cnr" onInsert={fn()} />,
};

export const DraftFactsPanelNoSlot: Story = {
  render: () => <FactsPanel facts={FACTS} onInsert={fn()} />,
};

export const DraftVersionDrawer: Story = {
  render: () => (
    <VersionDrawer
      versions={[
        { versionNo: 2, createdAt: '2026-03-02T10:00:00.000Z', blocks: BLOCKS },
        {
          versionNo: 1,
          createdAt: '2026-03-01T10:00:00.000Z',
          blocks: [{ type: 'paragraph', text: 'First draft.' }],
        },
      ]}
      currentVersionNo={2}
      currentBlocks={BLOCKS}
      onRestore={fn()}
    />
  ),
};

const STUDIO = {
  actions: {
    save: fn(() => Promise.resolve({ ok: true as const, data: { versionNo: 3, versionId: 'v3' } })),
    restore: fn(() =>
      Promise.resolve({ ok: true as const, data: { versionNo: 3, versionId: 'v3' } }),
    ),
  },
  workspaceId: 'w1',
  draftId: 'd1',
  title: 'Writ petition',
  versionNo: 2,
  blocks: BLOCKS,
  slotValues: { cnr: '[[missing: matter.cnr]]' },
  aiTexts: { n: 'Model-drafted summary of the facts.' },
  facts: FACTS,
  versions: [
    { versionNo: 2, createdAt: '2026-03-02T10:00:00.000Z', blocks: BLOCKS },
    {
      versionNo: 1,
      createdAt: '2026-03-01T10:00:00.000Z',
      blocks: [{ type: 'paragraph', text: 'First draft.' }] as Block[],
    },
  ],
};

export const DraftStudioShell: Story = { render: () => <DraftStudio {...STUDIO} /> };

export const DraftStudioShellNoAiText: Story = {
  render: () => <DraftStudio {...STUDIO} aiTexts={{}} />,
};
