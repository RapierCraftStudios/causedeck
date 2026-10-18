// check-stories: n/a Loading (choices apply instantly; pending saves show on the surrounding form)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarDays, CalendarRange, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';

import { FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

interface BoardViewProps {
  label?: ReactNode;
  error?: string;
  disabled?: boolean;
  withIcons?: boolean;
  items?: readonly [string, string, string];
  onValueChange?: (value: string) => void;
}

const VIEWS = ['today', 'tomorrow', 'week'] as const;

function BoardView({
  label = FORM.view.label,
  error,
  disabled,
  withIcons = false,
  items = ['Today', 'Tomorrow', 'This week'],
  onValueChange,
}: BoardViewProps) {
  const icons = [<Sun key="sun" />, <CalendarDays key="day" />, <CalendarRange key="week" />];
  return (
    <Field label={label} error={error} disabled={disabled}>
      <ToggleGroup type="single" defaultValue="today" onValueChange={onValueChange}>
        {VIEWS.map((view, index) => (
          <ToggleGroupItem key={view} value={view} className="max-w-60">
            {withIcons ? icons[index] : null}
            <span className="truncate">{items[index]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}

const meta = {
  title: 'Components/ToggleGroup',
  component: BoardView,
  args: { onValueChange: fn() },
} satisfies Meta<typeof BoardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('radiogroup', { name: FORM.view.label })).toBeVisible();
    await userEvent.click(canvas.getByRole('radio', { name: 'Tomorrow' }));
    await expect(canvas.getByRole('radio', { name: 'Tomorrow' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(args.onValueChange).toHaveBeenCalledWith('tomorrow');
  },
};

export const Multiple: Story = {
  render: () => (
    <ToggleGroup type="multiple" aria-label="Filters" size="sm">
      <ToggleGroupItem value="urgent">Urgent</ToggleGroupItem>
      <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
      <ToggleGroupItem value="unread">Unread orders</ToggleGroupItem>
    </ToggleGroup>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Urgent' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Mine' }));
    await expect(canvas.getByRole('button', { name: 'Urgent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('radio', { name: 'This week' }));
    await expect(canvas.getByRole('radio', { name: 'This week' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  },
};

/** Tab enters on the pressed item; arrow keys move focus within the group. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Today' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('radio', { name: 'Tomorrow' })).toHaveFocus());
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const item = canvas.getByRole('radio', { name: 'This week' });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: item },
      { keys: '[/MouseLeft]', target: item },
    ]);
    await expect(item).toHaveAttribute('data-state', 'on');
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    for (const item of canvas.getAllByRole('radio')) await expect(item).toBeDisabled();
  },
};

export const Invalid: Story = {
  args: { error: 'Pick a view.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = { args: { withIcons: true } };

export const LongText: Story = { args: { items: [LONG_LABEL, 'Tomorrow', 'This week'] } };

export const RtlNeutral: Story = {
  args: { withIcons: true },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: { label: 'பலகைக் காட்சி', items: ['இன்று', 'நாளை', 'இந்த வாரம்'] },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { label: 'ಬೋರ್ಡ್ ವೀಕ್ಷಣೆ', items: ['ಇಂದು', 'ನಾಳೆ', 'ಈ ವಾರ'] },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
