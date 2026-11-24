// The matter copilot panel (#1115, #1168): empty with suggested questions, loading, an answer with
// citation chips, not verified, error, plan limit, no authority, AI off, offline and a follow-up thread.
import type { CopilotAnswer } from '@causedeck/core/copilot';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CopilotPanel, type CopilotTurn } from './copilot-panel.tsx';

const usage = { used: 3, limit: 30 };
const base = {
  claims: [],
  unsupported: [],
  answerText: '',
  answer: '',
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

const matterContext = {
  title: 'Rao v. City Nursing Home (fictional)',
  stage: 'Evidence',
  nextDate: '2026-12-03',
};

/** No question yet: suggested questions built from the matter, and its context chips. */
export const Empty: Story = { args: { matterContext } };

const turn = (patch: Partial<CopilotTurn>): CopilotTurn => ({
  id: 't1',
  question: 'Did the surgeon need written consent before the operation?',
  requestId: '00000000-0000-4000-8000-000000000001',
  state: 'answered',
  ...patch,
});

export const Loading: Story = {
  args: { matterContext, initialTurns: [turn({ state: 'pending' })] },
};

export const Failed: Story = {
  args: {
    initialTurns: [turn({ state: 'failed', failure: { planLimit: false, message: '' } })],
  },
};

export const PlanLimit: Story = {
  args: {
    initialTurns: [
      turn({
        state: 'failed',
        failure: {
          planLimit: true,
          message: 'This workspace has used its 30 copilot questions this month.',
        },
      }),
    ],
  },
};

export const Offline: Story = { args: { matterContext, offline: true } };

const verifiedAnswer: CopilotAnswer = {
  ...base,
  answerText: 'Consent must be informed.',
  answer: 'Consent must be informed. [1]',
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
};

/** The written answer with a citation chip; its source in the rail (lg) or the sheet. */
export const Verified: Story = { args: { initialAnswer: verifiedAnswer } };

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

/** A follow-up: the earlier turn stays above, the rail shows the latest answer's sources. */
export const FollowUpThread: Story = {
  args: {
    matterContext,
    initialTurns: [
      turn({ answer: verifiedAnswer }),
      turn({
        id: 't2',
        question: 'Was that consent ever recorded?',
        requestId: '00000000-0000-4000-8000-000000000002',
        answer: {
          ...base,
          answer:
            'No record of written consent appears in the file [1]. The ward notes are silent [2].',
          claims: [
            {
              statement: 'No record of written consent appears in the file.',
              sourceId: 'doc:d1:3',
              kind: 'doc',
              quote: 'no consent form is on record',
              pinpoint: { page: 3, paragraph: 7 },
              documentId: 'd1',
              judgmentId: null,
            },
            {
              statement: 'The ward notes are silent.',
              sourceId: 'fact:f1',
              kind: 'fact',
              quote: 'the ward notes are silent',
              pinpoint: { page: null, paragraph: null },
              documentId: null,
              judgmentId: null,
            },
          ],
        },
      }),
    ],
  },
};
