import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import {
  ContextTestView,
  PreparednessTapView,
  PulseCardView,
  type ContextTestLabels,
  type ContextTestPhase,
  type PovState,
  type PulseLabels,
  type TapLabels,
} from './pov';

const tapLabels: TapLabels = {
  title: 'How prepared did you feel?',
  hint: 'Optional. Press 1 to 5, or S to skip.',
  legend: 'Preparedness from 1 to 5',
  option: (n) => `${String(n)} of 5`,
  skip: 'Skip',
  retry: 'Try again',
  messages: {
    saving: 'Saving',
    saved: 'Thanks, saved.',
    skipped: 'Skipped.',
    error: 'Could not save your rating.',
    offline: 'You are offline. Your rating will sync.',
    denied: 'Viewers are not asked this.',
  },
};

const meta = {
  title: 'Patterns/ProofOfValue',
  component: PreparednessTapView,
  args: {
    labels: tapLabels,
    state: 'default',
    value: null,
    onRate: fn(),
    onSkip: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof PreparednessTapView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default: keys 1-5 rate and `s` skips. */
export const TapDefault: Story = {
  play: async ({ canvasElement, args }) => {
    const group = within(canvasElement).getByRole('radiogroup');
    await userEvent.click(within(group).getByRole('radio', { name: '4 of 5' }));
    await expect(args.onRate).toHaveBeenCalledWith(4);
    await userEvent.keyboard('2');
    await expect(args.onRate).toHaveBeenCalledWith(2);
    await userEvent.keyboard('s');
    await expect(args.onSkip).toHaveBeenCalled();
  },
};
export const TapLoading: Story = { args: { state: 'saving' } };
export const TapSaved: Story = { args: { state: 'saved', value: 4 } };
export const TapSkipped: Story = { args: { state: 'skipped' } };
export const TapOffline: Story = { args: { state: 'offline', value: 3 } };
export const TapError: Story = {
  args: { state: 'error', value: 3 },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
export const TapDenied: Story = {
  args: { state: 'denied' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('radiogroup')).toBeNull();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Viewers');
  },
};

const pulseLabels: PulseLabels = {
  title: 'This week',
  intro: 'Three quick questions.',
  low: 'Low',
  high: 'High',
  option: (n) => `${String(n)} of 5`,
  submit: 'Save',
  dismiss: 'Not now',
  retry: 'Try again',
  messages: {
    saved: 'Thanks, saved.',
    dismissed: 'Dismissed until next week.',
    error: 'Could not save.',
    offline: 'You are offline. Your answers will sync.',
    denied: 'Viewers are not asked this.',
    saving: 'Saving',
  },
};
const items = [
  { id: 'demand', label: 'How demanding was your work?' },
  { id: 'worry', label: 'How much did you worry?' },
  { id: 'effort', label: 'How much effort did preparing take?' },
];
const pulse = {
  labels: pulseLabels,
  items,
  values: {},
  state: 'default' as PovState | 'dismissed',
  onChange: fn(),
  onSubmit: fn(),
  onDismiss: fn(),
  onRetry: fn(),
};

export const PulseDefault: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: pulse,
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(c.getAllByRole('radio', { name: '3 of 5' })[0] as HTMLElement);
    await expect(args.onChange).toHaveBeenCalledWith('demand', 3);
    await userEvent.keyboard('{Escape}');
    await expect(args.onDismiss).toHaveBeenCalled();
  },
};
export const PulseComplete: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: { ...pulse, values: { demand: 3, worry: 2, effort: 4 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};
export const PulseLoading: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: { ...pulse, state: 'saving', values: { demand: 3, worry: 2, effort: 4 } },
};
export const PulseSaved: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: { ...pulse, state: 'saved' },
};
export const PulseDismissed: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: { ...pulse, state: 'dismissed' },
};
export const PulseError: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: { ...pulse, state: 'error' },
};
export const PulseOffline: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: { ...pulse, state: 'offline' },
};
export const PulseDenied: StoryObj<typeof PulseCardView> = {
  render: (args) => <PulseCardView {...args} />,
  args: { ...pulse, state: 'denied' },
};

const testLabels: ContextTestLabels = {
  title: 'Context test',
  intro: 'Pick a matter, start the clock and answer the five questions.',
  start: 'Start the test',
  finish: 'Finish',
  again: 'Run another',
  retry: 'Try again',
  correct: 'Right',
  wrong: 'Wrong',
  elapsed: 'Elapsed time',
  empty: 'No matters to test on yet.',
  messages: {
    running: 'Timer started.',
    finished: 'Timer stopped. 4 of 5 right.',
    error: 'Could not save the test.',
    offline: 'You are offline. The test needs a connection.',
    denied: 'Only an owner can run the context test.',
  },
};
const questions = ['Stage', 'Last order', 'Next date', 'Obligations', 'Documents'].map(
  (label, i) => ({
    id: `q${String(i)}`,
    label,
    mark: null as boolean | null,
  }),
);
const test = {
  labels: testLabels,
  phase: 'ready' as ContextTestPhase,
  questions,
  elapsed: '0:00',
  matterPicker: <p>Matter: Fictional v Fictional</p>,
  onStart: fn(),
  onMark: fn(),
  onFinish: fn(),
  onAgain: fn(),
  onRetry: fn(),
};
const testStory = (args: Partial<typeof test>): StoryObj<typeof ContextTestView> => ({
  render: (a) => <ContextTestView {...a} />,
  args: { ...test, ...args },
});

export const TestReady: StoryObj<typeof ContextTestView> = {
  ...testStory({}),
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Start the test' }));
    await expect(args.onStart).toHaveBeenCalled();
  },
};
export const TestRunning: StoryObj<typeof ContextTestView> = {
  ...testStory({ phase: 'running', elapsed: '0:42' }),
  play: async ({ canvasElement, args }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Finish' })).toBeDisabled();
    await userEvent.click(
      within(canvasElement).getAllByRole('button', { name: 'Right' })[0] as HTMLElement,
    );
    await expect(args.onMark).toHaveBeenCalledWith('q0', true);
  },
};
export const TestFinished: StoryObj<typeof ContextTestView> = testStory({
  phase: 'finished',
  elapsed: '1:35',
  questions: questions.map((q) => ({ ...q, mark: true })),
});
export const TestError: StoryObj<typeof ContextTestView> = testStory({ phase: 'error' });
export const TestOffline: StoryObj<typeof ContextTestView> = testStory({ phase: 'offline' });
export const TestDenied: StoryObj<typeof ContextTestView> = testStory({ phase: 'denied' });
