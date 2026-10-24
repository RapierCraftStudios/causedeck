// The WhatsApp import (#527): a story per step and state. Fictional chat data only. The flow's Web
// Worker and the upload are covered by the e2e spec; here the steps render with mock handlers so
// the axe and visual checks cover each of them in both themes.
import { Alert } from '@causedeck/ui/alert';
import { PatternEmptyState, PermissionDenied } from '@causedeck/ui/patterns';
import { Progress } from '@causedeck/ui/progress';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { WifiOff } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { initialSelection } from '../../../lib/inbox/whatsapp-import/selection.ts';
import type { ImportRow, ParsedChat } from '../../../lib/inbox/whatsapp-import/types.ts';

import { ChatTypeStep } from './chat-type-step.tsx';
import { WhatsAppDisclosure } from './disclosure.tsx';
import { ReviewStep, type ReviewState } from './review-step.tsx';

const row = (n: number, text: string, extra: Partial<ImportRow> = {}): ImportRow => ({
  id: String(n),
  ts: `2026-10-${String(10 + (n % 15)).padStart(2, '0')}T09:${String(n % 60).padStart(2, '0')}:00`,
  sender: n % 2 === 0 ? 'Asha' : 'Ravi',
  text,
  rules: [],
  ...extra,
});

const rows: ImportRow[] = [
  row(0, 'Good morning, the hearing is moved to Monday. Please bring the file.'),
  row(1, 'Order uploaded to the shared folder.', { mediaRef: 'IMG-20261013-WA0001.jpg' }),
  row(2, 'Client Aadhaar 2345 6789 0123 for the affidavit', { rules: ['aadhaar'] }),
  row(3, 'PAN ABCDE1234F', { rules: ['pan'] }),
  row(4, 'The POCSO matter is listed at 11', { rules: ['sensitive_keyword'] }),
  ...Array.from({ length: 30 }, (_, i) => row(5 + i, `Filing update number ${String(i + 1)}`)),
];

const chat: ParsedChat = {
  title: 'Chambers',
  titleHash: '0'.repeat(64),
  dateOrder: 'dmy',
  dateOrderAmbiguous: true,
  senders: ['Asha', 'Ravi'],
  rows,
};

const meta = {
  title: 'Inbox/WhatsApp import',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disclosure: Story = { render: () => <WhatsAppDisclosure /> };

export const ChatType: Story = { render: () => <ChatTypeStep onInternal={fn()} /> };

export const Empty: Story = {
  render: () => (
    <PatternEmptyState message="No messages to import yet. Choose an export file to begin." />
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="grid gap-2" data-pattern-state="loading">
      <p role="status" className="text-ink text-sm">
        Reading the export, 40% done
      </p>
      <Progress aria-label="Reading the export" value={40} />
    </div>
  ),
};

export const ErrorState: Story = {
  render: () => (
    <Alert tone="danger" data-pattern-state="error">
      That file is not a valid zip export.
    </Alert>
  ),
};

export const Offline: Story = {
  render: () => (
    <Alert tone="warning" icon={<WifiOff />} data-pattern-state="offline">
      You&apos;re offline. You can read and choose messages, but importing needs a connection.
    </Alert>
  ),
};

export const Denied: Story = {
  render: () => <PermissionDenied message="Only owners and advocates can import chats." />,
};

function Review() {
  const [state, setState] = useState<ReviewState>({
    selected: initialSelection(rows),
    confirmed: new Set(),
  });
  return <ReviewStep chat={chat} state={state} onChange={setState} onFlipDateOrder={fn()} />;
}

export const Preview: Story = { render: () => <Review /> };
