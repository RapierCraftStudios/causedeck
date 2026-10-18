// check-stories: n/a Loading, Invalid (tabs only switch panels; loading and validation belong to the panel content)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarDays, FileText, ListChecks } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';

import { LONG_DESCRIPTION, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const SECTIONS = ['Hearings', 'Documents', 'Tasks'] as const;
const ICONS = [CalendarDays, FileText, ListChecks];

interface ExampleProps extends ComponentProps<typeof Tabs> {
  names?: readonly string[];
  icons?: boolean;
  disabledIndex?: number;
  panel?: string;
}

function Example({
  names = SECTIONS,
  icons = false,
  disabledIndex,
  panel = `Listed matters for ${MATTER_TITLE}.`,
  ...props
}: ExampleProps) {
  return (
    <Tabs defaultValue="0" className="w-96 max-w-full" {...props}>
      <TabsList aria-label="Matter sections">
        {names.map((name, index) => {
          const Icon = ICONS[index % ICONS.length] ?? CalendarDays;
          return (
            <TabsTrigger key={name} value={String(index)} disabled={index === disabledIndex}>
              {icons ? <Icon aria-hidden="true" /> : null}
              {name}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {names.map((name, index) => (
        <TabsContent key={name} value={String(index)}>
          {name}: {panel}
        </TabsContent>
      ))}
    </Tabs>
  );
}

const meta = {
  title: 'Components/Tabs',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('tab', { name: 'Hearings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(canvas.getByRole('tab', { name: 'Documents' }));
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent(/^Documents/);
  },
};

/** Keyboard: arrows move and activate (automatic activation), Home and End jump. */
export const KeyboardNavigation: Story = {
  play: async ({ canvas }) => {
    const [hearings, documents, tasks] = SECTIONS.map((name) => canvas.getByRole('tab', { name }));
    await userEvent.tab();
    await expect(hearings).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(documents).toHaveFocus();
    await expect(documents).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent(/^Documents/);
    await userEvent.keyboard('{End}');
    await expect(tasks).toHaveFocus();
    await expect(tasks).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    await expect(hearings).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(tasks).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(hearings).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent(/^Hearings/);
  },
};

/** At 360 px the list scrolls horizontally and fades its overflowing edge. */
export const NarrowScroll: Story = {
  args: {
    names: ['Hearings', 'Documents', 'Tasks', 'Orders', 'Parties', 'Fees', 'Notes', 'Activity'],
    className: 'w-[360px]',
  },
  play: async ({ canvas }) => {
    const list = canvas.getByRole('tablist');
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    await waitFor(() => expect(list).toHaveAttribute('data-fade-end'));
    await expect(list).not.toHaveAttribute('data-fade-start');
    await expect(list.style.maskImage).toContain('linear-gradient');
    list.scrollLeft = list.scrollWidth;
    await waitFor(() => expect(list).toHaveAttribute('data-fade-start'));
    await waitFor(() => expect(list).not.toHaveAttribute('data-fade-end'));
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const tab = canvas.getByRole('tab', { name: 'Tasks' });
    await userEvent.hover(tab);
    await expect(tab).toHaveAttribute('aria-selected', 'false');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const tab = canvas.getByRole('tab', { name: 'Hearings' });
    await expect(tab).toHaveFocus();
    await expect(tab.matches(':focus-visible')).toBe(true);
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const tab = canvas.getByRole('tab', { name: 'Tasks' });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: tab },
      { keys: '[/MouseLeft]', target: tab },
    ]);
    await expect(tab).toHaveAttribute('data-state', 'active');
  },
};

export const Disabled: Story = {
  args: { disabledIndex: 1 },
  play: async ({ canvas }) => {
    const tab = canvas.getByRole('tab', { name: 'Documents' });
    await expect(tab).toBeDisabled();
    await userEvent.click(tab, { pointerEventsCheck: 0 });
    await expect(tab).toHaveAttribute('aria-selected', 'false');
  },
};

export const WithIcon: Story = { args: { icons: true } };

export const LongText: Story = {
  args: { names: [MATTER_TITLE, 'Documents', 'Tasks'], panel: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    const list = canvas.getByRole('tablist');
    await expect(list.getBoundingClientRect().width).toBeLessThanOrEqual(384);
  },
};

/** Arrow keys follow reading direction; the fade sits on the inline end (left in RTL). */
export const RtlNeutral: Story = {
  args: { dir: 'rtl' },
  play: async ({ canvas }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(canvas.getByRole('tab', { name: 'Documents' })).toHaveFocus();
  },
};

export const Tamil: Story = { args: { names: OVERLAY_INDIC.ta.tabs, lang: 'ta' } };
export const Kannada: Story = { args: { names: OVERLAY_INDIC.kn.tabs, lang: 'kn' } };
