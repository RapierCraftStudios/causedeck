// The brief readiness ring on an item card (#59): a 28 px ring with the percent as its label. Without
// a brief score (the brief lands in #60) it is a dashed ring that reads "not started".
export interface ReadinessRingProps {
  /** 0-100, or null while no brief exists. */
  percent: number | null;
  label: string;
}

const R = 11;
const C = 2 * Math.PI * R;

export function ReadinessRing({ percent, label }: ReadinessRingProps) {
  const filled = percent === null ? 0 : (Math.min(100, Math.max(0, percent)) / 100) * C;
  return (
    <svg
      data-slot="readiness-ring"
      role="img"
      aria-label={label}
      viewBox="0 0 28 28"
      className="size-7 shrink-0 -rotate-90"
    >
      <circle
        cx="14"
        cy="14"
        r={R}
        fill="none"
        strokeWidth="3"
        className="stroke-border"
        strokeDasharray={percent === null ? '2 3' : undefined}
      />
      {percent === null ? null : (
        <circle
          cx="14"
          cy="14"
          r={R}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={`${String(filled)} ${String(C)}`}
        />
      )}
    </svg>
  );
}
