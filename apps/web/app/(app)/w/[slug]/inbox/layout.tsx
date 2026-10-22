// The inbox's frame (#48): one column that grows to the three zones of the shell at 1280 px, with
// the route's own `role=main` landmark left to the app shell.
import type { ReactNode } from 'react';

export default function InboxLayout({ children }: { children: ReactNode }) {
  return (
    <div data-route="inbox" className="mx-auto w-full max-w-[1400px]">
      {children}
    </div>
  );
}
