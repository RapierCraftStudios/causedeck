// The studio's authority drawer (#1144): loading, empty ("no authority found"), candidates, AI off for
// a sensitive matter and a failed call. Fictional data only.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { AuthorityDrawer, type AuthorityCandidateView } from './authority-drawer.tsx';

const candidates: AuthorityCandidateView[] = [
  {
    candidateRef: {
      judgmentId: '00000000-0000-4000-8000-0000000e0001',
      quote: 'no written consent was taken before the procedure',
      para: 12,
    },
    title: 'Rao v. City Nursing Home (fictional)',
    neutralCitation: '2019:MHC:99999',
    court: 'Madras High Court',
    sourceUrl: 'https://court.example/j1.pdf',
    page: 4,
    paragraph: 12,
  },
  {
    candidateRef: {
      judgmentId: '00000000-0000-4000-8000-0000000e0002',
      quote: 'informed consent is a continuing duty of the treating doctor',
      page: 7,
    },
    title: null,
    neutralCitation: null,
    court: null,
    sourceUrl: null,
    page: 7,
    paragraph: null,
  },
];

const meta = {
  title: 'Drafting/AuthorityDrawer',
  component: AuthorityDrawer,
  args: { status: 'ready', candidates, hasBlock: true, onPropose: fn(), onInsert: fn() },
} satisfies Meta<typeof AuthorityDrawer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Candidates: Story = {};
export const Idle: Story = { args: { status: 'idle', candidates: [] } };
export const Loading: Story = { args: { status: 'loading', candidates: [] } };
export const Empty: Story = { args: { status: 'ready', candidates: [] } };
export const AiBlocked: Story = { args: { status: 'aiBlocked', candidates: [] } };
export const ErrorState: Story = { args: { status: 'error', candidates: [] } };
export const NoBlock: Story = { args: { hasBlock: false, candidates: [] } };
export const Unsaved: Story = { args: { unsaved: true } };
