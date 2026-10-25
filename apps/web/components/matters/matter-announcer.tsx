'use client';
// The matter workspace's polite live region (#390): state changes (a confirmed date, a saved
// synopsis, the sensitive flag) are announced to screen readers without moving focus. The layout
// mounts one provider around the header and the tab content; cards call `useMatterAnnounce()`.
// The text is cleared first and set on the next frame, so the same message twice is read twice.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce>(() => {
  // No provider (an isolated component in a test): nothing to announce into.
});

export function useMatterAnnounce(): Announce {
  return useContext(AnnounceContext);
}

export function MatterAnnouncer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const announce = useCallback<Announce>((next) => {
    setMessage('');
    requestAnimationFrame(() => {
      setMessage(next);
    });
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" data-matter-announcer="" className="sr-only">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}
