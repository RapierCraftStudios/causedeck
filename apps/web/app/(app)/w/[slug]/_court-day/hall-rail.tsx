// The hall rail (#59): at phone width one hall shows at a time and this sticky rail picks it. The
// choice is `?hall=<id>`, so it survives reload and back navigation (links, no client state).
import Link from 'next/link';

export interface RailHall {
  key: string;
  label: string;
  count: number;
}

export function HallRail({
  halls,
  selected,
  hrefFor,
  label,
}: {
  halls: readonly RailHall[];
  selected: string;
  hrefFor: (hall: string) => string;
  label: string;
}) {
  if (halls.length < 2) return null;
  return (
    <nav
      aria-label={label}
      data-hall-rail
      className="bg-canvas sticky top-0 z-20 -mx-4 flex gap-1 overflow-x-auto px-4 py-2 md:hidden"
    >
      {halls.map((hall) => (
        <Link
          key={hall.key}
          href={hrefFor(hall.key)}
          replace={false}
          scroll={false}
          aria-current={hall.key === selected ? 'true' : undefined}
          className="border-border inline-flex min-h-11 min-w-11 shrink-0 items-center gap-1 rounded-full border px-3 text-sm aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground"
        >
          {hall.label}
          <span className="text-xs tabular-nums">{hall.count}</span>
        </Link>
      ))}
    </nav>
  );
}
