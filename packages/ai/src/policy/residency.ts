// India-only enforcement (ADR 0007, docs/product/09 §8). With India-only on, a task whose primary
// provider is outside India raises, and failover only ever lands on in-region providers: the
// gateway never routes outside India silently.
import { ResidencyViolationError } from '../errors.ts';
import type { Provider, TaskDef } from '../types.ts';

/** The AWS regions in India (Mumbai, Hyderabad). */
export const INDIA_REGIONS: readonly string[] = ['ap-south-1', 'ap-south-2'];

export function isIndiaRegion(region: string): boolean {
  return INDIA_REGIONS.includes(region);
}

/**
 * The providers a call may use, in failover order. `chain` is already ordered and filtered to
 * providers that support the task.
 */
export function allowedChain(
  task: TaskDef,
  chain: readonly Provider[],
  indiaOnly: boolean,
): Provider[] {
  if (!indiaOnly) return [...chain];
  const primary = chain[0];
  if (primary !== undefined && primary.dataResidency !== 'in') {
    throw new ResidencyViolationError(task.id, primary.id);
  }
  return chain.filter((p) => p.dataResidency === 'in');
}
