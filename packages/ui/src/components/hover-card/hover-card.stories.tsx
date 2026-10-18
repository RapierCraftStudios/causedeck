// check-stories: n/a Disabled, Loading, Invalid (a hover card previews a link; the link has no disabled, busy or invalid state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Scale } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import {
  LONG_DESCRIPTION,
  MATTER_TITLE,
  OTHER_MATTER,
  OVERLAY_INDIC,
} from '../__fixtures__/overlays';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';

interface ExampleProps extends ComponentProps<typeof HoverCard> {
  link?: string;
  title?: string;
  body?: string;
  icon?: boolean;
  content?: Omit<ComponentProps<typeof HoverCardContent>, 'children'>;
}

function Example({
  link = MATTER_TITLE,
  title = 'W.P. No. 1234 of 2026',
  body = 'Madras High Court. Next hearing 14 Nov 2026, Court 12.',
  icon = false,
  content,
  ...props
}: ExampleProps) {
  return (
    <HoverCard {...props}>
      <HoverCardTrigger asChild>
        <a
          href="#matter"
          onClick={(event) => {
            event.preventDefault();
          }}
          className="text-accent outline-ring inline-flex items-center gap-1.5 rounded-xs text-sm underline-offset-4 outline-offset-2 hover:underline focus-visible:outline-2"
        >
          {icon ? <Scale aria-hidden="true" className="size-4" /> : null}
          {link}
        </a>
      </HoverCardTrigger>
      <HoverCardContent {...content}>
        <div className="flex flex-col gap-1">
          <p className="text-ink font-medium">{title}</p>
          <p className="text-ink-muted">{body}</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

const meta = {
  title: 'Components/HoverCard',
  component: Example,
  args: { openDelay: 0, closeDelay: 0 },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story['play']>>[0]['canvas'];

const settled = (el: Element) => Promise.all(el.getAnimations().map((a) => a.finished));

const card = () =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-slot="hover-card-content"]');
    if (!el) throw new Error('hover card not open');
    return el;
  });

async function hoverOpen(canvas: Canvas) {
  await userEvent.hover(canvas.getByRole('link'));
  return card();
}

export const Default: Story = {
  play: async ({ canvas }) => {
    const content = await hoverOpen(canvas);
    await expect(content).toHaveAttribute('data-state', 'open');
    await expect(within(content).getByText('W.P. No. 1234 of 2026')).toBeInTheDocument();
  },
};

/** Moving the pointer away closes the card. */
export const Hover: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link');
    await hoverOpen(canvas);
    await userEvent.unhover(link);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="hover-card-content"]')).toBeNull(),
    );
  },
};

/** Keyboard users get the same preview when the link takes focus. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const link = canvas.getByRole('link');
    await expect(link.matches(':focus-visible')).toBe(true);
    await card();
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: link },
      { keys: '[/MouseLeft]', target: link },
    ]);
    await card();
  },
};

export const WithIcon: Story = {
  args: { icon: true },
  play: async ({ canvas }) => {
    await hoverOpen(canvas);
  },
};

export const LongText: Story = {
  args: { link: OTHER_MATTER, title: MATTER_TITLE, body: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    const content = await hoverOpen(canvas);
    await settled(content);
    await expect(Math.round(content.getBoundingClientRect().width)).toBe(288);
  },
};

export const RtlNeutral: Story = {
  args: { content: { dir: 'rtl' } },
  render: (args) => (
    <div dir="rtl">
      <Example {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const content = await hoverOpen(canvas);
    await expect(content).toHaveAttribute('dir', 'rtl');
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    link: OVERLAY_INDIC[lang].matters,
    title: OVERLAY_INDIC[lang].title,
    body: OVERLAY_INDIC[lang].description,
    content: { lang },
  },
  play: async ({ canvas }) => {
    const content = await hoverOpen(canvas);
    await expect(within(content).getByText(OVERLAY_INDIC[lang].title)).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
