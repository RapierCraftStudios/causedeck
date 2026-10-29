// Stories for the status link authoring surface (#88): sheet, list, preview and gated notice, with
// default, empty, loading, error, offline and denied states and play interaction tests.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import { StatusLinkGatedNotice } from './gated-notice.tsx';
import { StatusLinkList } from './link-list.tsx';
import { StatusLinkPreview } from './preview.tsx';
import { StatusLinkSheet, type StatusLinkSheetActions } from './status-link-sheet.tsx';

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });
const items = [
  {
    id: 'l1',
    headline: 'Hearing adjourned',
    state: 'active' as const,
    expiresAt: '2026-11-04T00:00:00.000Z',
    views: 3,
  },
  {
    id: 'l2',
    headline: 'Orders reserved',
    state: 'revoked' as const,
    expiresAt: '2026-10-30T00:00:00.000Z',
    views: 0,
  },
];
const actions: StatusLinkSheetActions = {
  create: () =>
    ok({
      id: 'l3',
      url: 'https://app.example/s/abcdefghijklmnop',
      expiresAt: '2026-11-04T00:00:00.000Z',
    }),
  revoke: () => ok({ id: 'l1' }),
  list: () => ok(items),
};
const failing: StatusLinkSheetActions = {
  ...actions,
  create: () => Promise.resolve({ ok: false as const, error: { code: 'CONFLICT', message: 'x' } }),
  list: () => Promise.resolve({ ok: false as const, error: { code: 'CONFLICT', message: 'x' } }),
};
const base = {
  workspaceId: 'w',
  matterId: 'm',
  contacts: [{ id: 'c1', name: 'Asha Rao' }],
  advocateName: 'R. Iyer',
  canCreate: true,
  actions,
};

const openSheet: NonNullable<StoryObj<typeof StatusLinkSheet>['play']> = async ({
  canvasElement,
}) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Share a status link' }));
};

const meta = { title: 'Matters/Status links', component: StatusLinkSheet } satisfies Meta<
  typeof StatusLinkSheet
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: base,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Share a status link' }),
    );
    await userEvent.selectOptions(await body.findByLabelText('Client contact'), 'c1');
    await userEvent.type(body.getByLabelText('Headline'), 'Hearing adjourned');
    await userEvent.type(body.getByLabelText('Note'), 'Next hearing in November.');
    await userEvent.click(body.getByRole('button', { name: 'Create link' }));
    await expect(await body.findByText('Your link is ready')).toBeVisible();
    await expect(body.getByText('Share it yourself. CauseDeck does not send it.')).toBeVisible();
  },
};
export const Empty: Story = { play: openSheet, args: { ...base, contacts: [] } };
export const Loading: Story = {
  play: openSheet,
  args: { ...base, actions: { ...actions, list: () => new Promise(() => undefined) } },
};
export const ErrorState: Story = { play: openSheet, args: { ...base, actions: failing } };
export const Offline: Story = {
  args: base,
  play: async (context) => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    await openSheet(context);
  },
};
export const Denied: Story = { play: openSheet, args: { ...base, canCreate: false } };

export const ListDefault: StoryObj<typeof StatusLinkList> = {
  render: () => (
    <StatusLinkList
      list={{ state: 'ready', items }}
      canRevoke
      onRevoke={() => undefined}
      onRetry={() => undefined}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Viewed 3 times/)).toBeVisible();
  },
};
export const ListEmpty: StoryObj<typeof StatusLinkList> = {
  render: () => (
    <StatusLinkList
      list={{ state: 'ready', items: [] }}
      canRevoke
      onRevoke={() => undefined}
      onRetry={() => undefined}
    />
  ),
};
export const ListLoading: StoryObj<typeof StatusLinkList> = {
  render: () => (
    <StatusLinkList
      list={{ state: 'loading' }}
      canRevoke
      onRevoke={() => undefined}
      onRetry={() => undefined}
    />
  ),
};
export const ListError: StoryObj<typeof StatusLinkList> = {
  render: () => (
    <StatusLinkList
      list={{ state: 'error' }}
      canRevoke
      onRevoke={() => undefined}
      onRetry={() => undefined}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
  },
};
export const ListDenied: StoryObj<typeof StatusLinkList> = {
  render: () => (
    <StatusLinkList
      list={{ state: 'ready', items }}
      canRevoke={false}
      onRevoke={() => undefined}
      onRetry={() => undefined}
    />
  ),
};

export const PreviewDefault: StoryObj<typeof StatusLinkPreview> = {
  render: () => (
    <StatusLinkPreview
      headline="Hearing adjourned"
      note="Next hearing in November."
      nextDate="2026-11-12"
      language="en"
      advocateName="R. Iyer"
      expiresAt="2026-11-04T00:00:00.000Z"
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Prepared by R. Iyer')).toBeVisible();
  },
};
export const PreviewTamil: StoryObj<typeof StatusLinkPreview> = {
  render: () => (
    <StatusLinkPreview
      headline="விசாரணை ஒத்திவைப்பு"
      note="அடுத்த விசாரணை நவம்பரில்."
      nextDate={null}
      language="ta"
      advocateName={null}
      expiresAt="2026-11-04T00:00:00.000Z"
    />
  ),
};
export const GatedNotice: StoryObj<typeof StatusLinkGatedNotice> = {
  render: () => <StatusLinkGatedNotice />,
};
