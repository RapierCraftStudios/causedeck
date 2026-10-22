import { BudgetExceededError } from '../errors.ts';
import type { AiPolicyContext, AuditRecord, BudgetReservation, GatewayPorts } from '../ports.ts';
import type { GatewayResult } from '../types.ts';

export interface Harness {
  ports: GatewayPorts;
  events: string[];
  audit: AuditRecord[];
  stored: Map<string, GatewayResult>;
  policy: AiPolicyContext;
  budget: { remaining: number };
}

/** In-memory ports that log the order of budget and audit calls. */
export function harness(overrides: Partial<AiPolicyContext> = {}): Harness {
  const events: string[] = [];
  const audit: AuditRecord[] = [];
  const stored = new Map<string, GatewayResult>();
  const policy: AiPolicyContext = {
    indiaOnly: true,
    matterSensitive: false,
    captureAiBlocked: false,
    ...overrides,
  };
  const budget = { remaining: 1_000_000 };
  let n = 0;
  const ports: GatewayPorts = {
    settings: { getPolicy: () => Promise.resolve(policy) },
    budget: {
      reserve: (_ws, paise): Promise<BudgetReservation> => {
        events.push(`reserve:${String(paise)}`);
        if (paise > budget.remaining) return Promise.reject(new BudgetExceededError());
        return Promise.resolve({ id: 'r1' });
      },
      commit: (_ws, _r, paise, callId) => {
        events.push(`commit:${String(paise)}:${callId}`);
        return Promise.resolve();
      },
      release: () => {
        events.push('release');
        return Promise.resolve();
      },
    },
    audit: {
      record: (_ws, record) => {
        n += 1;
        audit.push(record);
        events.push(`audit:${record.status}`);
        return Promise.resolve({ id: `call-${String(n)}` });
      },
    },
    idempotency: {
      get: (_ws, key) => Promise.resolve(stored.get(key) ?? null),
      put: (_ws, key, result) => {
        stored.set(key, result);
        return Promise.resolve();
      },
    },
  };
  return { ports, events, audit, stored, policy, budget };
}

export const WS = '00000000-0000-4000-8000-000000000001';
export const ctx = { workspaceId: WS, purpose: 'capture.test' } as const;
