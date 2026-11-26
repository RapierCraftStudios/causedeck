// India-only enforcement (ADR 0007, docs/product/09 §8). With India-only on, a task whose primary
// provider is outside India raises, and failover only ever lands on in-region providers: the
// gateway never routes outside India silently.
//
// Preview-only exception (#1165): the `chatgpt-plan` provider is never in-region. It is allowed only
// when the caller's policy sets `previewPlanProvider` (core sets it for a demo workspace while
// AI_PROVIDER=chatgpt-plan and ALLOW_PREVIEW_PLAN_PROVIDER=true). Any other workspace raises
// `ResidencyViolationError` on a plan primary, whatever India-only says: real client data never
// reaches it.
//
// Preview-only self-hosted embeddings (#1198): a self-hosted embed server (bge-m3) reports region
// `SELF_HOSTED_REGION`. `embedDataResidency` treats it as in-India only when the caller passes
// `previewSelfHosted` (core sets it from ALLOW_PREVIEW_SELF_HOSTED_EMBED, which config refuses in
// production). Production residency is unchanged: only the AWS India regions are in-region.
import { ResidencyViolationError } from '../errors.ts';
import type { Provider, ProviderId, TaskDef } from '../types.ts';

/** The AWS regions in India (Mumbai, Hyderabad). */
export const INDIA_REGIONS: readonly string[] = ['ap-south-1', 'ap-south-2'];

/** The preview-only Sign in with ChatGPT plan provider (demo workspaces only). */
export const PREVIEW_PLAN_PROVIDER_ID: ProviderId = 'chatgpt-plan';

export function isIndiaRegion(region: string): boolean {
  return INDIA_REGIONS.includes(region);
}

/** Region reported by a self-hosted embed server (preview only, #1198). */
export const SELF_HOSTED_REGION = 'self-hosted';

export interface EmbedDataResidencyOptions {
  /** True only on a preview with ALLOW_PREVIEW_SELF_HOSTED_EMBED=true. */
  previewSelfHosted?: boolean | undefined;
}

/**
 * Data residency of an embed provider in `region`: `'in'` for an AWS India region, or for
 * `SELF_HOSTED_REGION` when `previewSelfHosted` is true; `'other'` otherwise.
 */
export function embedDataResidency(
  region: string,
  opts: EmbedDataResidencyOptions = {},
): 'in' | 'other' {
  if (isIndiaRegion(region)) return 'in';
  if (region === SELF_HOSTED_REGION && opts.previewSelfHosted === true) return 'in';
  return 'other';
}

export interface AllowedChainOptions {
  /** True only for a demo workspace with the preview plan provider configured. */
  previewPlanProvider?: boolean;
}

/**
 * The providers a call may use, in failover order. `chain` is already ordered and filtered to
 * providers that support the task.
 */
export function allowedChain(
  task: TaskDef,
  chain: readonly Provider[],
  indiaOnly: boolean,
  opts: AllowedChainOptions = {},
): Provider[] {
  const isPlan = (p: Provider): boolean => p.id === PREVIEW_PLAN_PROVIDER_ID;
  const primary = chain[0];
  if (opts.previewPlanProvider !== true) {
    if (primary !== undefined && isPlan(primary)) {
      throw new ResidencyViolationError(task.id, primary.id);
    }
    return indiaOnlyChain(
      task,
      chain.filter((p) => !isPlan(p)),
      indiaOnly,
    );
  }
  if (primary !== undefined && isPlan(primary)) {
    // The plan provider leads: keep it, then whatever the India-only rule keeps of the rest.
    const rest = chain.slice(1).filter((p) => !isPlan(p));
    return [primary, ...(indiaOnly ? rest.filter((p) => p.dataResidency === 'in') : rest)];
  }
  const kept = indiaOnlyChain(
    task,
    chain.filter((p) => !isPlan(p)),
    indiaOnly,
  );
  const plan = chain.filter(isPlan);
  return [...kept, ...plan];
}

function indiaOnlyChain(task: TaskDef, chain: readonly Provider[], indiaOnly: boolean): Provider[] {
  if (!indiaOnly) return [...chain];
  const primary = chain[0];
  if (primary !== undefined && primary.dataResidency !== 'in') {
    throw new ResidencyViolationError(task.id, primary.id);
  }
  return chain.filter((p) => p.dataResidency === 'in');
}
