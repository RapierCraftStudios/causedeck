// Enquiry log (#875, #87 part 3): populated, empty, offline, the route's loading, error and denied
// states, the keyboard shortcuts (n, j, c, Esc) and Tamil/Kannada names. Actions are mocked. Export
// names carry the `EnquiryList` prefix: story names are unique across apps/web.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { PermissionDeniedPage } from '../../../../../../../components/shell/permission-denied-page.tsx';
import type {
  ConflictCheckView,
  EnquiryRowView,
} from '../../../../../../../lib/intake/intake-deps.ts';
import type { Result } from '../../../../../../../lib/safe-action.ts';
import EnquiriesError from '../error.tsx';
import EnquiriesLoading from '../loading.tsx';
import type { EnquiryActions } from './enquiry-actions.ts';
import { EnquiryList } from './enquiry-list.tsx';

type Done = Result<{ id: string; status: string }>;
const done = (): Promise<Done> => Promise.resolve({ ok: true, data: { id: 'e', status: 'ok' } });

const CHECK: ConflictCheckView = {
  checkedAt: '2026-10-20T09:00:00.000Z',
  partyCount: 2,
  hits: [
    {
      checked: 'Fictional Trading Co',
      side: 'adverse',
      matterId: '00000000-0000-4000-8000-0000000a0001',
      matterTitle: 'Fictional Trading Co v. Example Estates',
      matchedName: 'Fictional Trading Company',
      existingRole: 'client',
      score: 0.92,
      reason: 'Similar name to your client on this matter.',
    },
  ],
};

const row = (
  n: number,
  enquirerName: string,
  over: Partial<EnquiryRowView> = {},
): EnquiryRowView => ({
  id: `00000000-0000-4000-8000-0000000e00${String(n).padStart(2, '0')}`,
  status: 'logged',
  channel: 'phone',
  enquirerName,
  summary: 'Asks for help with a lease dispute.',
  practiceArea: null,
  receivedAt: '2026-10-19T09:00:00.000Z',
  closedReason: null,
  hasProposal: false,
  parties: [],
  ...over,
});

const ENQUIRIES = [
  row(1, 'Asha Raman'),
  row(2, 'Fictional Trading Co', { status: 'checked', channel: 'email' }),
  row(3, 'Ravi Menon', { status: 'declined', closedReason: 'Outside practice area.' }),
];

const actions = (): EnquiryActions => ({
  log: fn(done),
  update: fn(done),
  check: fn(() => Promise.resolve({ ok: true, data: CHECK }) as Promise<Result<ConflictCheckView>>),
  accept: fn(done),
  close: fn(done),
});

const meta = {
  title: 'People/Enquiries/EnquiryList',
  component: EnquiryList,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    enquiries: ENQUIRIES,
    actions: actions(),
    forceOffline: false,
  },
} satisfies Meta<typeof EnquiryList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EnquiryListDefault: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
    await expect(canvas.getByText('Declined')).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: 'New enquiry' })[0]).toBeEnabled();
  },
};

export const EnquiryListEmpty: Story = {
  args: { enquiries: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No enquiries yet')).toBeVisible();
  },
};

export const EnquiryListOffline: Story = {
  args: { forceOffline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('button', { name: 'New enquiry' })[0]).toBeDisabled();
    await expect(canvas.getAllByRole('button', { name: 'Close' })[0]).toBeDisabled();
  },
};

/** The route's skeleton (loading.tsx). */
export const EnquiryListLoading: Story = {
  render: () => <EnquiriesLoading />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading enquiries')).toBeInTheDocument();
  },
};

/** The route's error boundary (error.tsx): Retry calls reset, the server message never shows. */
export const EnquiryListError: Story = {
  render: () => <EnquiriesError error={new Error('secret detail')} reset={fn()} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(canvas.queryByText('secret detail')).toBeNull();
  },
};

/** A role without `enquiry.read`. */
export const EnquiryListDenied: Story = {
  render: () => <PermissionDeniedPage />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1 })).toBeVisible();
  },
};

/** `n` opens the form; `Esc` closes it. */
export const EnquiryListNewShortcut: Story = {
  play: async () => {
    await userEvent.keyboard('n');
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(screen.queryByRole('dialog')).toBeNull();
  },
};

/** `j` moves onto the first row, `c` runs the check on the reviewed row. */
export const EnquiryListCheckShortcut: Story = {
  play: async ({ canvas }) => {
    await userEvent.keyboard('j');
    await userEvent.click(canvas.getAllByRole('button', { name: 'Review' })[0] as HTMLElement);
    await userEvent.keyboard('c');
    await expect(await canvas.findByText('1 match found')).toBeVisible();
    await expect(canvas.getByText('Possible conflict. Review before you proceed.')).toBeVisible();
  },
};

export const EnquiryListTamil: Story = {
  args: { enquiries: [row(4, 'முருகன் இளங்கோவன்')] },
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('முருகன் இளங்கோவன்')).toBeVisible();
  },
};

export const EnquiryListKannada: Story = {
  args: { enquiries: [row(5, 'ಕಾವೇರಿ ಗೌಡ')] },
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('ಕಾವೇರಿ ಗೌಡ')).toBeVisible();
  },
};
