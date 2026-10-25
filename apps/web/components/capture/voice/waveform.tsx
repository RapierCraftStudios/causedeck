'use client';
// The recorder's level bars (#543). Under `prefers-reduced-motion` the bars give way to one steady
// bar, so nothing animates.

export interface WaveformProps {
  /** 0-1 levels, oldest first. */
  levels: readonly number[];
  label: string;
}

export function Waveform({ levels, label }: WaveformProps) {
  return (
    <div role="img" aria-label={label} data-slot="voice-waveform" className="h-12 w-full">
      <div className="flex h-full items-center justify-center gap-0.5 motion-reduce:hidden">
        {levels.map((level, i) => (
          <span
            // Bars are positional; the list only ever shifts left.
            key={i}
            className="bg-accent w-1 rounded-full"
            style={{ height: `${String(Math.max(8, Math.round(level * 100)))}%` }}
          />
        ))}
      </div>
      <div className="hidden h-full items-center justify-center motion-reduce:flex">
        <span className="bg-accent h-1 w-2/3 rounded-full" />
      </div>
    </div>
  );
}
