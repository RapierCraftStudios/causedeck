// check-stories: n/a Loading, Invalid (disclosure only; loading and validation belong to the panel content)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarDays } from 'lucide-react';
import { expect, userEvent, waitFor } from 'storybook/test';

import { LONG_DESCRIPTION, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';

interface ExampleProps {
  dir?: 'ltr' | 'rtl';
  lang?: string;
  defaultValue?: string;
  items?: readonly string[];
  body?: string;
  icon?: boolean;
  disabledIndex?: number;
}

function Example({
  items = ['Hearings', 'Documents', 'Tasks'],
  body = `Listed for ${MATTER_TITLE}.`,
  icon = false,
  disabledIndex,
  ...props
}: ExampleProps) {
  return (
    <Accordion type="single" collapsible className="w-96 max-w-full" {...props}>
      {items.map((item, index) => (
        <AccordionItem key={item} value={String(index)} disabled={index === disabledIndex}>
          <AccordionTrigger>
            <span className="inline-flex items-center gap-2">
              {icon ? <CalendarDays aria-hidden="true" /> : null}
              {item}
            </span>
          </AccordionTrigger>
          <AccordionContent>{body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

const meta = {
  title: 'Components/Accordion',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Hearings' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('region', { name: 'Hearings' })).toHaveTextContent(MATTER_TITLE);
    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  },
};

export const Keyboard: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Hearings' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    const documents = canvas.getByRole('button', { name: 'Documents' });
    await expect(documents).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(documents).toHaveAttribute('aria-expanded', 'true');
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Tasks' });
    await userEvent.hover(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Hearings' }).matches(':focus-visible')).toBe(
      true,
    );
  },
};

export const Active: Story = {
  args: { defaultValue: '0' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Hearings' })).toHaveAttribute(
      'data-state',
      'open',
    );
  },
};

export const Disabled: Story = {
  args: { disabledIndex: 1 },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Documents' });
    await expect(trigger).toBeDisabled();
  },
};

export const WithIcon: Story = { args: { icon: true } };

export const LongText: Story = {
  args: { items: [MATTER_TITLE, 'Documents'], body: LONG_DESCRIPTION, defaultValue: '0' },
};

export const RtlNeutral: Story = { args: { dir: 'rtl', defaultValue: '0' } };

export const Tamil: Story = {
  args: { items: OVERLAY_INDIC.ta.tabs, body: OVERLAY_INDIC.ta.description, lang: 'ta' },
};

export const Kannada: Story = {
  args: { items: OVERLAY_INDIC.kn.tabs, body: OVERLAY_INDIC.kn.description, lang: 'kn' },
};
