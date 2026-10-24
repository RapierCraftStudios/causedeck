// The capture inbox (#48): a story per card kind and per state. Fictional data only. The shell
// (server actions, router) is covered by the e2e journeys; here the cards, lists and states render
// with mock handlers so the visual baselines cover every one of them in both themes.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { ReadyItem } from '../../lib/inbox/ready-providers.ts';
import type { InboxItemView, ProcessingItemView } from '../../lib/inbox/view.ts';

import { CaptureRow } from './capture-row.tsx';
import { EmptyNeedsYou, EmptyReady, FirstRun } from './empty-states.tsx';
import { NeedsYouList } from './needs-you-list.tsx';
import { ProcessingList } from './processing-list.tsx';
import { ProposalCardHost, type CardHandlers } from './proposal-card-host.tsx';
import { ReadyToSendList } from './ready-to-send-list.tsx';
import { SourcePreview } from './source-preview.tsx';

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ANCHOR = {
  id: ID(90),
  documentId: ID(91),
  page: 2,
  quote: 'Post the matter on 12.11.2026 for filing of the counter affidavit.',
  highlight: { start: 16, end: 26 },
};

const base: InboxItemView = {
  id: ID(1),
  type: 'proposal',
  kind: 'next_date',
  proposalId: ID(1),
  captureId: ID(80),
  matterId: ID(70),
  matterTitle: 'Meera Rao v. Example Traders (fictional)',
  proceedingId: ID(71),
  caseNumber: 'W.P. 12345 of 2026',
  sensitive: false,
  payload: { proceedingId: ID(71), date: '2026-11-12' },
  currentDate: null,
  confidence: 0.93,
  needsYouReason: null,
  anchors: [ANCHOR],
  createdAt: '2026-11-01T04:00:00.000Z',
  reassignUntil: '2026-11-08T04:00:00.000Z',
  canKeep: false,
};

const handlers: CardHandlers = {
  confirm: fn(() => Promise.resolve()),
  editConfirm: fn(() => Promise.resolve()),
  dismiss: fn(() => Promise.resolve()),
  chooseDate: fn(() => Promise.resolve()),
  keepAttachment: fn(() => Promise.resolve()),
  keyLine: fn(() => Promise.resolve()),
  reassign: fn(() => Promise.resolve()),
  searchMatters: fn(() => Promise.resolve([{ id: ID(72), title: 'Another matter (fictional)' }])),
  retake: fn(),
};

const meta = {
  title: 'Inbox/Cards',
  component: ProposalCardHost,
  args: {
    item: base,
    locale: 'en',
    handlers,
    offline: false,
    readOnly: false,
    onConfirmed: fn(),
    onCollapse: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProposalCardHost>;

export default meta;
type Story = StoryObj<typeof meta>;

const kind = (
  type: InboxItemView['kind'],
  payload: Record<string, unknown>,
  extra: Partial<InboxItemView> = {},
): Story => ({ args: { item: { ...base, kind: type, payload, ...extra } } });

export const NextDate: Story = {};
export const NewMatter = kind(
  'new_matter',
  { title: 'Meera Rao v. Example Traders (fictional)' },
  { matterId: null, caseNumber: null },
);
export const NewProceeding = kind('new_proceeding', { caseType: 'W.A.', number: '88', year: 2026 });
export const ListingUpdate = kind('listing_update', { itemNo: '42' });
export const ObligationFromDirection = kind('obligation_from_direction', {
  description: 'File the compliance report',
  dueDate: '2026-11-20',
});
export const Task = kind('task', { title: 'File the counter (fictional)', dueDate: '2026-11-07' });
export const PartyDetail = kind('party_detail', { name: 'Example Traders Pvt Ltd (fictional)' });
export const HearingOutcome = kind('order_record', {
  orderDate: '2026-11-01',
  nextDate: '2026-11-12',
});
export const LowConfidence: Story = {
  args: { item: { ...base, confidence: 0.42, needsYouReason: 'low confidence' } },
};
export const Sensitive: Story = {
  args: { item: { ...base, sensitive: true, payload: null, anchors: [] } },
};
export const ReadOnly: Story = { args: { readOnly: true } };
export const Offline: Story = { args: { offline: true } };
export const Conflict: Story = {
  args: {
    item: { ...base, type: 'conflict', currentDate: '2026-10-30', needsYouReason: 'conflict' },
  },
};
export const Unreadable: Story = {
  args: {
    item: {
      ...base,
      id: ID(2),
      type: 'unreadable',
      kind: null,
      proposalId: null,
      payload: null,
      anchors: [],
      matterTitle: null,
      canKeep: true,
    },
  },
};

const proposals: InboxItemView[] = [
  base,
  {
    ...base,
    id: ID(3),
    kind: 'task',
    payload: { title: 'File the counter (fictional)', dueDate: '2026-11-07' },
  },
  { ...base, id: ID(4), type: 'conflict', currentDate: '2026-10-30' },
];

export const PopulatedList: Story = {
  render: () => (
    <NeedsYouList
      items={proposals}
      locale="en"
      handlers={handlers}
      offline={false}
      readOnly={false}
      collapsing={new Set()}
      generation={{}}
      fresh={new Set()}
      selectedId={null}
      onSelect={fn()}
      onConfirmed={fn()}
    />
  ),
};

export const EmptyNeeds: Story = { render: () => <EmptyNeedsYou /> };
export const EmptyReadyToSend: Story = { render: () => <EmptyReady /> };
export const FirstRunEmpty: Story = {
  render: () => (
    <FirstRun
      channels={[
        { channel: 'share', enabled: true },
        { channel: 'voice', enabled: false },
        { channel: 'upload', enabled: true },
      ]}
    />
  ),
};

const rows: ProcessingItemView[] = (['received', 'scanning', 'queued', 'processing'] as const).map(
  (status, index) => ({
    captureId: ID(60 + index),
    channel: ['upload', 'share', 'voice', 'camera'][index] ?? 'upload',
    status,
    createdAt: '2026-11-01T04:00:00.000Z',
    localOnly: false,
  }),
);

const fallbackRow: ProcessingItemView = {
  captureId: ID(60),
  channel: 'upload',
  status: 'received',
  createdAt: '2026-11-01T04:00:00.000Z',
  localOnly: false,
};

export const Processing: Story = { render: () => <ProcessingList rows={rows} locale="en" /> };
export const ProcessingOfflineQueued: Story = {
  render: () => (
    <ul>
      <CaptureRow row={{ ...(rows[0] ?? fallbackRow), localOnly: true }} locale="en" />
    </ul>
  ),
};

const ready: ReadyItem[] = [
  {
    id: 'd1',
    providerId: 'story',
    title: 'Update for Meera Rao (fictional)',
    summary: 'Hearing on 12 Nov 2026. Draft in English.',
    actions: [
      { id: 'copy', kind: 'copy', text: 'Hearing is on 12 Nov 2026.' },
      { id: 'wa', kind: 'open', app: 'WhatsApp', href: 'https://wa.me/' },
    ],
  },
];

export const ReadyToSend: Story = {
  render: () => (
    <ReadyToSendList
      items={ready}
      readOnly={false}
      offline={false}
      onMarkSent={fn(() => Promise.resolve())}
    />
  ),
};

export const PreviewPane: Story = {
  render: () => <SourcePreview item={base} slug="chennai-chambers" />,
};
