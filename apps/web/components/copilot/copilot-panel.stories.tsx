// The matter copilot panel (#1115): verified claims, an unverified claim, no authority found and AI off.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CopilotPanel } from './copilot-panel.tsx';

const usage = { used: 3, limit: 30 };
const base = {
  claims: [],
  unsupported: [],
  answerText: '',
  noAuthority: false,
  judgments: {},
  aiBlocked: false,
  usage,
};
const ask = () => Promise.resolve({ ok: false as const, error: { message: '' } });

const meta = {
  title: 'Copilot/CopilotPanel',
  component: CopilotPanel,
  args: { workspaceId: 'w', matterId: 'm', ask },
} satisfies Meta<typeof CopilotPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Verified: Story = {
  args: {
    initialAnswer: {
      ...base,
      answerText: 'Consent must be informed.',
      claims: [
        {
          statement: 'Consent must be informed.',
          sourceId: 'seg:1',
          kind: 'seg',
          quote: 'consent must be informed',
          pinpoint: { page: 4, paragraph: 12 },
          documentId: null,
          judgmentId: 'j1',
        },
      ],
      judgments: {
        j1: {
          id: 'j1',
          title: 'A v B',
          court: 'High Court',
          neutralCitation: null,
          sourceUrl: 'https://court.example/j.pdf',
        },
      },
    },
  },
};

export const NotVerified: Story = {
  args: {
    initialAnswer: {
      ...base,
      unsupported: [
        {
          statement: 'The court awarded costs.',
          sourceId: 'seg:9',
          quote: 'costs',
          reason: 'quote_not_found',
        },
      ],
    },
  },
};

export const NoAuthority: Story = { args: { initialAnswer: { ...base, noAuthority: true } } };
export const AiOff: Story = { args: { initialAnswer: { ...base, aiBlocked: true } } };

/** #1144: a verified judgment claim with "Insert into draft" (the matter's drafts as targets). */
export const InsertIntoDraft: Story = {
  args: {
    ...Verified.args,
    drafts: [
      {
        id: 'd1',
        title: 'Written statement (fictional)',
        versionId: 'v3',
        href: '#',
        blocks: [
          { key: 'b.0', label: 'Preliminary submissions' },
          {
            key: 'b.1',
            label: 'The plaintiff did not obtain written consent before the procedure.',
          },
        ],
      },
      {
        id: 'd2',
        title: 'Rejoinder (fictional)',
        versionId: 'v1',
        href: '#',
        blocks: [{ key: 'b.0', label: 'Grounds' }],
      },
    ],
    insert: () => Promise.resolve({ ok: true as const, data: {} }),
  },
};
