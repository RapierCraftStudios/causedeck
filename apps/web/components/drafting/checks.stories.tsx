// The drafting checks (#828): a story per component and state. Fictional data only.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { AckDialog } from './ack-dialog.tsx';
import { CitationPanel, type CitationView } from './citation-panel.tsx';
import { ConsistencyPanel } from './consistency-panel.tsx';
import { DraftExportDialog } from './export-dialog.tsx';

const citations: CitationView[] = [
  {
    id: 'c1',
    blockId: 'b1',
    raw: '2021 SCC OnLine Mad 100',
    status: 'verified',
    acknowledged: false,
  },
  {
    id: 'c2',
    blockId: 'b2',
    raw: '2019 SCC OnLine Mad 999',
    status: 'not_found',
    acknowledged: false,
  },
  { id: 'c3', blockId: 'b3', raw: 'Rao v. Traders', status: 'unknown', acknowledged: false },
];

const meta = { title: 'Drafting/Checks' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Citations: Story = {
  render: () => (
    <CitationPanel citations={citations} onCheck={fn()} onJump={fn()} onAcknowledge={fn()} />
  ),
};

export const CitationsEmpty: Story = {
  render: () => <CitationPanel citations={[]} onCheck={fn()} onJump={fn()} onAcknowledge={fn()} />,
};

export const Consistency: Story = {
  render: () => (
    <ConsistencyPanel
      findings={[
        {
          id: 'f1',
          severity: 'error',
          found: '12 March',
          expected: '14 March',
          span: { blockKey: 'b1', start: 0, end: 8 },
          provenance: { fact: 'hearing.date' },
          fix: { replacement: '14 March' },
        } as never,
      ]}
      undoVersionNo={2}
      onJump={fn()}
      onFix={fn().mockResolvedValue(true)}
      onUndo={fn().mockResolvedValue(true)}
    />
  ),
};

export const ConsistencyClean: Story = {
  render: () => <ConsistencyPanel findings={[]} onJump={fn()} onFix={fn()} onUndo={fn()} />,
};

export const Acknowledge: Story = {
  render: () => (
    <AckDialog open onOpenChange={fn()} count={1} onConfirm={fn().mockResolvedValue(true)} />
  ),
};

const link = { url: '#', filename: 'mention-memo.docx' };
export const ExportReady: Story = {
  render: () => (
    <DraftExportDialog
      open
      onOpenChange={fn()}
      courtPreset="madras_hc"
      aiAssisted
      unacknowledged={0}
      onAcknowledge={fn()}
      onExport={fn().mockResolvedValue(link)}
    />
  ),
};

export const ExportBlocked: Story = {
  render: () => (
    <DraftExportDialog
      open
      onOpenChange={fn()}
      courtPreset={null}
      aiAssisted={false}
      unacknowledged={1}
      onAcknowledge={fn()}
      onExport={fn()}
    />
  ),
};
