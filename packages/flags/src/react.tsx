'use client';
// Client mirror of server-evaluated flags (#22). The server evaluates (`evaluateAll`) and passes the
// boolean snapshot down; this module only reads it, for UX (hiding nav, showing a feature). It never
// decides anything security-relevant, and it never sees rows, legal notes or descriptions: the
// provider keeps only the registered keys' boolean values.
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { FlagKey, FlagSnapshot } from './keys.ts';

const FlagsContext = createContext<Readonly<Partial<Record<string, boolean>>> | null>(null);

export interface FlagsProviderProps {
  /** From `evaluateAll` on the server. Only `true` counts as on. */
  flags: FlagSnapshot;
  children?: ReactNode;
}

/** Keep only boolean values, so nothing else from the server object reaches the client tree. */
export function sanitizeSnapshot(flags: FlagSnapshot): Readonly<Partial<Record<string, boolean>>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(flags).filter(([, value]) => typeof value === 'boolean'),
    ) as Record<string, boolean>,
  );
}

export function FlagsProvider({ flags, children }: FlagsProviderProps) {
  const value = useMemo(() => sanitizeSnapshot(flags), [flags]);
  return <FlagsContext.Provider value={value}>{children}</FlagsContext.Provider>;
}

/** Whether `key` is on; `false` outside a provider or for a key the snapshot lacks. */
export function useFlag(key: FlagKey): boolean {
  return useContext(FlagsContext)?.[key] === true;
}

/** `(key) => boolean` over the snapshot, for the shell's `isEnabled` props. */
export function useIsEnabled(): (key: FlagKey) => boolean {
  const flags = useContext(FlagsContext);
  return useMemo(() => (key: FlagKey) => flags?.[key] === true, [flags]);
}

export interface FeatureProps {
  flag: FlagKey;
  children?: ReactNode;
  fallback?: ReactNode;
}

/** Render `children` only while `flag` is on. UX only: the server enforces with `requireFlag`. */
export function Feature({ flag, children, fallback = null }: FeatureProps) {
  return useFlag(flag) ? children : fallback;
}
