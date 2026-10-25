// The matter workspace's polite live region (#390): state changes are announced to screen readers
// without moving focus. The story's button stands in for a card that calls `useMatterAnnounce()`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { MatterAnnouncer, useMatterAnnounce } from './matter-announcer.tsx';

function Announce({ message }: { message: string }) {
  const announce = useMatterAnnounce();
  return (
    <button
      type="button"
      className="border-line rounded-md border px-3 py-2 text-sm"
      onClick={() => {
        announce(message);
      }}
    >
      {message}
    </button>
  );
}

const meta = {
  title: 'Matters/MatterAnnouncer',
  component: MatterAnnouncer,
  args: { children: <Announce message="Next date confirmed." /> },
} satisfies Meta<typeof MatterAnnouncer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Polite: Story = {
  play: async ({ canvas, canvasElement }) => {
    const region = canvasElement.querySelector('[data-matter-announcer]');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await userEvent.click(canvas.getByRole('button'));
    await waitFor(() => expect(region).toHaveTextContent('Next date confirmed.'));
  },
};

export const Tamil: Story = {
  args: { children: <Announce message="அடுத்த தேதி உறுதிசெய்யப்பட்டது." /> },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { children: <Announce message="ಮುಂದಿನ ದಿನಾಂಕ ದೃಢೀಕರಿಸಲಾಗಿದೆ." /> },
  globals: { locale: 'kn' },
};
