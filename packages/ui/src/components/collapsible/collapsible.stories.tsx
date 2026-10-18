// check-stories: n/a Invalid (disclosure only; validation belongs to the content)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ChevronsUpDown, Users } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';

import { MATTER_TITLE, OTHER_MATTER, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

interface ExampleProps extends ComponentProps<typeof Collapsible> {
  label?: string;
  rows?: readonly string[];
  icon?: boolean;
  loading?: boolean;
}

function Example({
  label = 'Linked matters',
  rows = [MATTER_TITLE, OTHER_MATTER],
  icon = false,
  loading = false,
  ...props
}: ExampleProps) {
  return (
    <Collapsible className="flex w-96 max-w-full flex-col gap-2" {...props}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" loading={loading} disabled={props.disabled}>
          {icon ? <Users aria-hidden="true" /> : null}
          <span className="truncate">{label}</span>
          <ChevronsUpDown aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="text-ink flex flex-col gap-1 text-sm">
          {rows.map((row) => (
            <li key={row} className="border-line rounded-md border px-3 py-2">
              {row}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

const meta = {
  title: 'Components/Collapsible',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Linked matters' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText(OTHER_MATTER)).toBeVisible();
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.queryByText(OTHER_MATTER)).toBeNull());
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button');
    await userEvent.hover(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const trigger = canvas.getByRole('button');
    await expect(trigger.matches(':focus-visible')).toBe(true);
    await userEvent.keyboard('{Enter}');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  },
};

export const Active: Story = { args: { defaultOpen: true } };

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toBeDisabled();
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  },
};

export const WithIcon: Story = { args: { icon: true } };

export const LongText: Story = {
  args: { label: `Linked matters of ${MATTER_TITLE}`, defaultOpen: true },
};

export const RtlNeutral: Story = { args: { dir: 'rtl', defaultOpen: true } };

export const Tamil: Story = {
  args: {
    label: OVERLAY_INDIC.ta.matters,
    rows: OVERLAY_INDIC.ta.tabs,
    lang: 'ta',
    defaultOpen: true,
  },
};

export const Kannada: Story = {
  args: {
    label: OVERLAY_INDIC.kn.matters,
    rows: OVERLAY_INDIC.kn.tabs,
    lang: 'kn',
    defaultOpen: true,
  },
};
