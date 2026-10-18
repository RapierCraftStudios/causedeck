// check-stories: n/a Disabled, Loading, Invalid (a static list opened by a key; nothing to disable, load or validate)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Keyboard } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { INDIC } from '../__fixtures__/labels';
import { MATTER_TITLE, OVERLAY_INDIC, SHORTCUTS } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import { ShortcutsDialog, type ShortcutsDialogProps } from './shortcuts-dialog';

const meta = {
  title: 'Components/ShortcutsDialog',
  component: ShortcutsDialog,
  args: { shortcuts: SHORTCUTS, mac: false },
} satisfies Meta<typeof ShortcutsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

async function pressQuestionMark() {
  await userEvent.keyboard('{Shift>}?{/Shift}');
  return page().findByRole('dialog', { name: /Keyboard shortcuts|குறுக்குவழிகள்|ಶಾರ್ಟ್‌ಕಟ್‌ಗಳು/ });
}

/** `?` opens the list, Esc closes it. */
export const Default: Story = {
  play: async () => {
    const dialog = await pressQuestionMark();
    await expect(within(dialog).getByText('Go to today')).toBeInTheDocument();
    await expect(within(dialog).getByText('G then T')).toBeInTheDocument();
    await expect(within(dialog).getByText('Ctrl+K')).toBeInTheDocument();
    await expect(within(dialog).getByRole('region', { name: 'Navigation' })).toBeInTheDocument();
  },
};

export const KeyboardToggle: Story = {
  play: async () => {
    await pressQuestionMark();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
    // `?` toggles: pressing it again opens, and once more closes.
    await pressQuestionMark();
    await userEvent.keyboard('{Shift>}?{/Shift}');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
  },
};

/** `?` is ignored while typing in a field. */
export const IgnoredWhileTyping: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <label className="text-ink text-sm" htmlFor="note">
        Note
      </label>
      <input id="note" className="border-line-control rounded-md border px-2 py-1" />
      <ShortcutsDialog {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Note'), 'Why?');
    await expect(canvas.getByLabelText('Note')).toHaveValue('Why?');
    await expect(page().queryByRole('dialog')).toBeNull();
  },
};

/** Controlled by the app shell: the hotkey is off and a button opens it. */
function Controlled(args: ShortcutsDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Keyboard aria-hidden="true" />
        Shortcuts
      </Button>
      <ShortcutsDialog {...args} enableHotkey={false} open={open} onOpenChange={setOpen} />
    </>
  );
}

export const Hover: Story = {
  render: (args) => <Controlled {...args} />,
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button', { name: 'Shortcuts' }));
    await userEvent.keyboard('{Shift>}?{/Shift}');
    await expect(page().queryByRole('dialog')).toBeNull();
  },
};

export const FocusVisible: Story = {
  render: (args) => <Controlled {...args} />,
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Shortcuts' });
    await userEvent.tab();
    await expect(trigger.matches(':focus-visible')).toBe(true);
    await userEvent.keyboard('{Enter}');
    const dialog = await page().findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
    await expect(trigger).toHaveFocus();
    await expect(dialog).not.toBeInTheDocument();
  },
};

export const Active: Story = {
  render: (args) => <Controlled {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Shortcuts' }));
    await expect(await page().findByRole('dialog')).toHaveAttribute('data-state', 'open');
  },
};

export const WithIcon: Story = Active;

export const LongText: Story = {
  args: {
    shortcuts: [
      ...SHORTCUTS,
      {
        keys: 'g then c',
        description: `Go to the cause list for ${MATTER_TITLE}`,
        group: 'Navigation',
      },
    ],
  },
  play: async () => {
    const dialog = await pressQuestionMark();
    await expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(512);
  },
};

export const RtlNeutral: Story = {
  args: { content: { dir: 'rtl' } },
  play: async () => {
    const dialog = await pressQuestionMark();
    await expect(dialog).toHaveAttribute('dir', 'rtl');
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    labels: {
      title: OVERLAY_INDIC[lang].shortcuts,
      close: OVERLAY_INDIC[lang].close,
      then: INDIC[lang].then,
    },
    shortcuts: SHORTCUTS.map((s, i) => ({
      ...s,
      description:
        OVERLAY_INDIC[lang].actions[i % OVERLAY_INDIC[lang].actions.length] ?? s.description,
    })),
    content: { lang },
  },
  play: async () => {
    const dialog = await pressQuestionMark();
    await expect(within(dialog).getByText(`G ${INDIC[lang].then} T`)).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
