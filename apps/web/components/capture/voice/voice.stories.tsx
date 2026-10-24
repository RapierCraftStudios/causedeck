// Voice recorder (#543): a story per state (record, hold, review, denied, onboarding) so the visual
// baselines cover them in both themes at 360, 768 and 1280.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { HoldToTalkButton } from './hold-to-talk-button.tsx';
import { RecordingReview } from './recording-review.tsx';
import { VoiceDenied, VoiceOnboardingNote } from './voice-onboarding-note.tsx';
import { Waveform } from './waveform.tsx';

const levels = Array.from({ length: 32 }, (_, i) => 0.15 + 0.7 * Math.abs(Math.sin(i / 3)));
const labels = { hold: 'Hold to record', stop: 'Stop recording', slideCancel: 'Slide to cancel' };

const meta = {
  title: 'Capture/Voice',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Onboarding: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col items-center gap-4">
      <VoiceOnboardingNote />
      <HoldToTalkButton
        recording={false}
        labels={labels}
        onStart={fn()}
        onStop={fn()}
        onCancel={fn()}
      />
    </div>
  ),
};

export const Recording: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col items-center gap-4">
      <Waveform levels={levels} label="Sound level" />
      <span className="text-ink text-2xl tabular-nums">00:12</span>
      <HoldToTalkButton recording labels={labels} onStart={fn()} onStop={fn()} onCancel={fn()} />
    </div>
  ),
};

export const Review: Story = {
  render: () => (
    <div className="max-w-sm">
      <RecordingReview
        url=""
        durationMs={12000}
        workspaceId="00000000-0000-4000-8000-0000000000aa"
        searchMatters={() => Promise.resolve({ ok: true, data: [] })}
        matterId="00000000-0000-4000-8000-000000000001"
        onPickMatter={fn()}
        onClearMatter={fn()}
        busy={false}
        onAgain={fn()}
        onSave={fn()}
      />
    </div>
  ),
};

export const MicDenied: Story = {
  render: () => (
    <div className="max-w-sm">
      <VoiceDenied kind="denied" />
    </div>
  ),
};

export const MicUnavailable: Story = {
  render: () => (
    <div className="max-w-sm">
      <VoiceDenied kind="unavailable" />
    </div>
  ),
};
