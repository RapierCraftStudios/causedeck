import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { NOW, OBLIGATIONS } from '../__fixtures__/trust';
import { ObligationEmpty, ObligationRow, ObligationRowSkeleton } from './obligation-row';

const meta = {
  title: 'Patterns/ObligationRow',
  component: ObligationRow,
  args: { ...OBLIGATIONS.today, now: NOW, onDone: fn(), onSnooze: fn() },
  argTypes: {
    presentation: { control: 'inline-radio', options: ['auto', 'pointer', 'touch'] },
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ObligationRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);
const moreOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: /^More actions for/ });

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Due today')).toBeInTheDocument();
    await expect(
      within(canvasElement).getByRole('img', { name: 'Gowri Shankar' }),
    ).toBeInTheDocument();
  },
};

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(moreOf(canvasElement));
  },
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    const more = moreOf(canvasElement);
    while (document.activeElement !== more) await userEvent.tab();
    await expect(more.matches(':focus-visible')).toBe(true);
  },
};

/** The non-gesture alternative: the overflow menu offers Done and Snooze from the keyboard. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    moreOf(canvasElement).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body().getByRole('menuitem', { name: 'Mark done' })).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onSnooze).toHaveBeenCalledOnce();
  },
};

/** Offline: actions are disabled and the row says why. */
export const Disabled: Story = {
  args: { offline: true },
  play: async ({ canvasElement }) => {
    await expect(moreOf(canvasElement)).toBeDisabled();
  },
};

export const Loading: Story = {
  render: () => <ObligationRowSkeleton />,
};

export const Invalid: Story = {
  args: { error: 'Could not snooze. Try again.' },
};

/** Overdue: danger-soft background plus icon plus text, never colour alone. */
export const WithIcon: Story = {
  args: { ...OBLIGATIONS.overdue },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Overdue by 3 days')).toBeInTheDocument();
  },
};

export const LongText: Story = {
  args: {
    title:
      'File counter affidavit with the additional typed set and the vakalat of the newly impleaded respondent',
    matter: `${OBLIGATIONS.overdue.matter} and connected matters`,
  },
};

export const RtlNeutral: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: {
    title: 'எதிர் மனு தாக்கல் செய்யவும்',
    matter: 'காவேரி டெக்ஸ்டைல்ஸ் எதிர் தமிழ்நாடு அரசு',
  },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: {
    title: 'ಕಚೇರಿ ಆಕ್ಷೇಪಣೆಗಳನ್ನು ಪಾಲಿಸಿ',
    matter: 'ಮಲ್ನಾಡ್ ಕಾಫಿ ಬೆಳೆಗಾರರು ವಿರುದ್ಧ ಕರ್ನಾಟಕ ಅರಣ್ಯ ಇಲಾಖೆ',
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};

export const Upcoming: Story = {
  args: { ...OBLIGATIONS.upcoming },
};

/** Touch widths: swipe left for Done, right for Snooze. */
export const Touch: Story = {
  args: { presentation: 'touch' },
  play: async ({ canvasElement, args }) => {
    const surface = canvasElement.querySelector('[data-slot="obligation-surface"]');
    if (!(surface instanceof HTMLElement)) throw new Error('no surface');
    const { left, top, width } = surface.getBoundingClientRect();
    const x = left + width / 2;
    const init = { pointerId: 1, pointerType: 'touch', bubbles: true, clientY: top + 10 };
    surface.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x }));
    surface.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x - 100 }));
    surface.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: x - 100 }));
    await expect(args.onDone).toHaveBeenCalledOnce();
  },
};

export const PermissionDenied: Story = {
  args: { viewOnly: true },
};

export const Empty: Story = {
  render: () => <ObligationEmpty />,
};
