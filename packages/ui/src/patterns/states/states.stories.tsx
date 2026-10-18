// check-stories: n/a Disabled (state screens replace content; disabled actions live in each pattern's Offline story)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NOW, PROPOSALS } from '../__fixtures__/trust';
import { ProposalCard } from '../proposal-card/proposal-card';
import type { Proposal } from '../types';
import { PATTERN_EMPTY_COPY, PatternEmptyState, type PatternEmptyKind } from './empty-state';
import { ErrorState } from './error-state';
import { PatternSkeleton, SKELETON_PATTERNS } from './loading-skeletons';
import { NotFound } from './not-found';
import { OfflineBanner } from './offline-banner';
import { PERMISSION_DENIED_COPY, PermissionDenied } from './permission-denied';

const meta = {
  title: 'Patterns/States',
  component: ErrorState,
  args: {
    title: 'Could not load the cause list.',
    description: 'Your saved list from this morning is still here.',
    onRetry: fn(),
    supportHref: 'mailto:support@lawyer-os.in',
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

const KINDS = Object.keys(PATTERN_EMPTY_COPY) as PatternEmptyKind[];

/** Every state screen together: empty, loading, error, offline, permission denied, not found. */
export const Default: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      <PatternEmptyState kind="activity" actionLabel="Forward an order" onAction={fn()} />
      <PatternSkeleton pattern="proposal-card" />
      <ErrorState {...args} />
      <OfflineBanner savedAt={NOW} />
      <PermissionDenied />
      <NotFound actionLabel="Back to matters" onAction={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(PATTERN_EMPTY_COPY.activity)).toBeVisible();
    await expect(canvas.getByRole('status', { busy: true })).toBeInTheDocument();
    await expect(canvas.getByRole('alert')).toBeVisible();
    await expect(canvas.getByText(/^You are offline\. Showing saved data from /)).toBeVisible();
    await expect(canvas.getByText(PERMISSION_DENIED_COPY)).toBeVisible();
  },
};

const retry = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: 'Try again' });

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(retry(canvasElement));
  },
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    const button = retry(canvasElement);
    while (document.activeElement !== button) await userEvent.tab();
    await expect(button.matches(':focus-visible')).toBe(true);
  },
};

/** Try again calls back; the support link is a plain link. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(retry(canvasElement));
    await expect(args.onRetry).toHaveBeenCalledOnce();
    await expect(
      within(canvasElement).getByRole('link', { name: 'Contact support' }),
    ).toHaveAttribute('href', 'mailto:support@lawyer-os.in');
  },
};

/** One skeleton per pattern, each with its pattern's footprint; static under reduced motion. */
export const Loading: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {SKELETON_PATTERNS.map((pattern) => (
        <div key={pattern} className="flex flex-col gap-1">
          <p className="text-ink-muted font-sans text-xs">{pattern}</p>
          <PatternSkeleton pattern={pattern} />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('status')).toHaveLength(
      SKELETON_PATTERNS.length,
    );
  },
};

/** Error: what happened, Try again and a support link. */
export const Invalid: Story = {
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole('alert');
    await expect(within(alert).getByText('Could not load the cause list.')).toBeVisible();
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(within(alert).getByRole('link', { name: 'Contact support' })).toBeVisible();
  },
};

/** The empty copy for each surface, with its icon and one primary action. */
export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {KINDS.map((kind) => (
        <PatternEmptyState key={kind} kind={kind} actionLabel="Forward an order" onAction={fn()} />
      ))}
    </div>
  ),
};

export const Empty: Story = {
  render: () => <PatternEmptyState kind="proposals" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Nothing needs you right now.')).toBeVisible();
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};

/** Offline: the banner sits above read-only content whose actions are disabled with a reason. */
export const Offline: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <OfflineBanner savedAt={NOW} />
      <ProposalCard proposal={PROPOSALS[0] as Proposal<string>} offline onConfirm={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent(
      /^You are offline\. Showing saved data from .+\.$/,
    );
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  },
};

export const PermissionDeniedState: Story = {
  name: 'Permission denied',
  render: () => <PermissionDenied />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('You do not have access to this. Ask the workspace owner.'),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector('[data-slot="permission-denied-lock"]'),
    ).not.toBeNull();
  },
};

export const NotFoundState: Story = {
  name: 'Not found',
  render: () => <NotFound actionLabel="Back to matters" onAction={fn()} />,
};

export const LongText: Story = {
  args: {
    title:
      'Could not load the cause list for the High Court of Judicature at Madras, Principal Seat, Court Hall 12, for 14 November 2026.',
    description:
      'The court website did not respond. Your saved list from this morning is still here, and we will try again in a few minutes.',
  },
};

export const RtlNeutral: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  render: () => (
    <div lang="ta" className="flex flex-col gap-4">
      <OfflineBanner
        savedAt={NOW}
        labels={{
          message: (time) => `நீங்கள் இணைப்பில் இல்லை. ${time} அன்று சேமித்த தரவு காட்டப்படுகிறது.`,
        }}
      />
      <PermissionDenied message="இதை அணுக உங்களுக்கு அனுமதி இல்லை. பணியிட உரிமையாளரிடம் கேளுங்கள்." />
      <ErrorState
        title="வழக்குப் பட்டியலை ஏற்ற முடியவில்லை."
        onRetry={fn()}
        labels={{ retry: 'மீண்டும் முயலவும்', support: 'உதவியைத் தொடர்புகொள்ளவும்' }}
        supportHref="mailto:support@lawyer-os.in"
      />
    </div>
  ),
};

export const Kannada: Story = {
  render: () => (
    <div lang="kn" className="flex flex-col gap-4">
      <OfflineBanner
        savedAt={NOW}
        labels={{
          message: (time) =>
            `ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ. ${time} ರಂದು ಉಳಿಸಿದ ಡೇಟಾವನ್ನು ತೋರಿಸಲಾಗುತ್ತಿದೆ.`,
        }}
      />
      <PermissionDenied message="ಇದಕ್ಕೆ ನಿಮಗೆ ಪ್ರವೇಶವಿಲ್ಲ. ಕಾರ್ಯಸ್ಥಳದ ಮಾಲೀಕರನ್ನು ಕೇಳಿ." />
      <ErrorState
        title="ಕಾಸ್ ಲಿಸ್ಟ್ ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ."
        onRetry={fn()}
        labels={{ retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ', support: 'ಬೆಂಬಲವನ್ನು ಸಂಪರ್ಕಿಸಿ' }}
        supportHref="mailto:support@lawyer-os.in"
      />
    </div>
  ),
};
