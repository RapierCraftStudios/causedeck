import type { ComponentState } from '../../lib/status/model.ts';
import { OVERALL_LABELS, STATE_ICONS, type IconName } from '../../lib/status/format.ts';

const PATHS: Record<IconName, string> = {
  check: 'M5 12l5 5 9-10',
  warning: 'M12 4l9 16H3L12 4zM12 10v4M12 17v.5',
  cross: 'M6 6l12 12M18 6L6 18',
};
const TONES: Record<ComponentState, string> = {
  operational: 'border-line bg-success-soft text-ink [&_svg]:text-success',
  degraded: 'border-line bg-warning-soft text-ink [&_svg]:text-warning',
  down: 'border-danger bg-danger-soft text-ink [&_svg]:text-danger',
};

/** A status glyph; decorative, the adjacent text always carries the meaning. */
export function StatusIcon({ state, className }: { state: ComponentState; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      data-icon={STATE_ICONS[state]}
    >
      <path d={PATHS[STATE_ICONS[state]]} />
    </svg>
  );
}

export function OverallBanner({ overall }: { overall: ComponentState }) {
  return (
    <div
      role="status"
      data-state={overall}
      className={`flex items-center gap-3 rounded-md border px-4 py-4 text-lg font-semibold ${TONES[overall]}`}
    >
      <StatusIcon state={overall} />
      <span>{OVERALL_LABELS[overall]}</span>
    </div>
  );
}
