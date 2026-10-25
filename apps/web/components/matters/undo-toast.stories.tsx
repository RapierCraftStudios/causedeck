// Undo toast (#392): shown after a merge or a split for 10 seconds. A story renders a button that
// fires it, with a Toaster mounted as the app layout does.
import { Button } from '@causedeck/ui/button';
import { Toaster, toast } from '@causedeck/ui/sonner';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { showUndoToast, type ShowUndoToastOptions } from './undo-toast.tsx';

const labels = {
  action: 'Undo',
  done: 'Undone.',
  conflict: 'Something changed since. Nothing was undone.',
  failed: "Couldn't undo. Try again.",
};

function UndoToastDemo(options: ShowUndoToastOptions) {
  return (
    <>
      <Button
        type="button"
        onClick={() => {
          showUndoToast(options);
        }}
      >
        Merge matters
      </Button>
      <Toaster />
    </>
  );
}

const meta = {
  title: 'Matters/UndoToast',
  component: UndoToastDemo,
  // Sonner's toast store is module-global: drop what an earlier story left so one `Undo` is shown.
  beforeEach: () => {
    toast.dismiss();
  },
  args: {
    message: 'Merged 2 proceedings into the matter.',
    labels,
    undo: fn((): ReturnType<ShowUndoToastOptions['undo']> =>
      Promise.resolve({ ok: true as const, data: null }),
    ),
  },
} satisfies Meta<typeof UndoToastDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

async function fire(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Merge matters' }));
}

export const Offered: Story = {
  play: async ({ canvasElement }) => {
    await fire(canvasElement);
    // The toast fades in: wait until it is shown.
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toBeVisible());
  },
};

export const Undone: Story = {
  play: async ({ canvasElement, args }) => {
    await fire(canvasElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    const done = await screen.findByText('Undone.');
    await waitFor(() => expect(done).toBeVisible());
    await expect(args.undo).toHaveBeenCalledTimes(1);
  },
};

export const Conflict: Story = {
  args: {
    undo: fn((): ReturnType<ShowUndoToastOptions['undo']> =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'CONFLICT' as const, message: '' },
      }),
    ),
  },
  play: async ({ canvasElement }) => {
    await fire(canvasElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    const message = await screen.findByText('Something changed since. Nothing was undone.');
    await waitFor(() => expect(message).toBeVisible());
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
