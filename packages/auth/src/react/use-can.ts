'use client';
// Client mirror of the permission policy (#234). `useCan` calls the same `can()` the server
// enforces with, so UI and API agree; it only hides or disables UI and is never the only check.
// No rules live here: the actor comes from `PolicyProvider`, the decision from `../policy`.
import { createContext, createElement, useContext, type ReactNode } from 'react';

import type { Action } from '../policy/actions';
import { can, type Actor, type Decision, type PolicySettings, type Resource } from '../policy/can';

interface PolicyValue {
  actor: Actor;
  settings: PolicySettings | undefined;
}

const PolicyContext = createContext<PolicyValue | null>(null);

export interface PolicyProviderProps {
  /** Who is acting in which workspace, from the server-loaded workspace context. */
  actor: Actor;
  settings?: PolicySettings;
  children?: ReactNode;
}

export function PolicyProvider({ actor, settings, children }: PolicyProviderProps) {
  return createElement(PolicyContext.Provider, { value: { actor, settings } }, children);
}

const NO_PROVIDER: Decision = { allow: false, reason: 'ROLE_DENIED' };

/** The policy decision for the current actor; denies when no `PolicyProvider` is mounted. */
export function useCan(action: Action, resource?: Resource): Decision {
  const value = useContext(PolicyContext);
  if (value === null) return NO_PROVIDER;
  return can(value.actor, action, resource, value.settings);
}
