// check-stories: n/a Hover, FocusVisible, Active, Disabled, Loading (a static message; its action is a Button with its own states)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Lock, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';

import { Button } from '../button/button';
import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import { Alert, AlertDescription, AlertTitle, type AlertTone } from './alert';

const TONES: AlertTone[] = ['neutral', 'info', 'success', 'warning', 'danger'];

const meta = {
  title: 'Components/Alert',
  component: Alert,
  args: { tone: 'info' },
  argTypes: { tone: { control: 'inline-radio', options: TONES } },
  decorators: [
    (Story) => (
      <div className="w-112">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>Hearing moved</AlertTitle>
      <AlertDescription>The matter is now listed on 14 Nov 2026 in Court 12.</AlertDescription>
    </Alert>
  ),
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Hearing moved');
  },
};

export const Tones: Story = {
  render: () => (
    <div className="grid gap-3">
      {TONES.map((tone) => (
        <Alert key={tone} tone={tone} role="note">
          <AlertTitle>{tone}</AlertTitle>
          <AlertDescription>The matter is now listed on 14 Nov 2026.</AlertDescription>
        </Alert>
      ))}
    </div>
  ),
};

/** Error state with retry: role=alert, icon plus text so colour is not the only signal. */
export const Invalid: Story = {
  render: () => {
    function Demo() {
      const [tries, setTries] = useState(0);
      return (
        <Alert
          tone="danger"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTries((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        >
          <AlertTitle>Could not load hearings</AlertTitle>
          <AlertDescription>
            {tries === 0
              ? 'Check your connection and try again.'
              : `Retried ${String(tries)} time(s).`}
          </AlertDescription>
        </Alert>
      );
    }
    return <Demo />;
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not load hearings');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.getByText('Retried 1 time(s).')).toBeInTheDocument();
  },
};

export const WithIcon: Story = {
  render: () => (
    <div className="grid gap-3">
      <Alert tone="neutral" icon={<WifiOff />}>
        <AlertDescription>You are offline. Showing saved data.</AlertDescription>
      </Alert>
      <Alert tone="warning" icon={<Lock />}>
        <AlertDescription>
          You do not have access to this. Ask the workspace owner.
        </AlertDescription>
      </Alert>
    </div>
  ),
};

export const LongText: Story = {
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>{LONG_LABEL}</AlertTitle>
      <AlertDescription>{`${LONG_LABEL}. ${LONG_LABEL}.`}</AlertDescription>
    </Alert>
  ),
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <Alert
        {...args}
        action={
          <Button size="sm" variant="outline">
            Try again
          </Button>
        }
      >
        <AlertTitle>Hearing moved</AlertTitle>
      </Alert>
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta">
      <Alert {...args} tone="neutral" icon={<WifiOff />}>
        <AlertTitle>{INDIC.ta.offline}</AlertTitle>
        <AlertDescription>{INDIC.ta.hearing}</AlertDescription>
      </Alert>
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn">
      <Alert {...args} tone="neutral" icon={<WifiOff />}>
        <AlertTitle>{INDIC.kn.offline}</AlertTitle>
        <AlertDescription>{INDIC.kn.hearing}</AlertDescription>
      </Alert>
    </div>
  ),
};
