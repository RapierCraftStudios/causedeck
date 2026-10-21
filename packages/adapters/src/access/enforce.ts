// Access-mode enforcement for adapters (#369, ADR 0011, ADR 0015). Layered on the registry check
// in `@causedeck/flags/access-mode`, which reads `access_mode_registry` once: a resource runs only
// with an enabled row whose mode equals the adapter's declared one, and any mode but
// `user_supplied` also needs counsel's note. A declared `none` is refused before any read.
import {
  AccessModeError,
  assertAccessMode as assertRegistryAccessMode,
  type AccessModeDenial,
} from '@causedeck/flags/access-mode';

import {
  AccessModeSchema,
  ResourceSchema,
  type AccessMode,
  type CourtAdapter,
  type Resource,
} from '../types.ts';

/** The registry read's dependencies (the db handle), as `@causedeck/flags` takes them. */
export type AccessModeDeps = Parameters<typeof assertRegistryAccessMode>[1];

/** An adapter tried to use a resource the registry does not allow in its declared mode. */
export class AccessModeViolationError extends AccessModeError {
  readonly adapterId: string;
  readonly resource: string;
  readonly mode: string;

  constructor(reason: AccessModeDenial, adapterId: string, resource: string, mode: string) {
    super(reason, adapterId, resource);
    this.name = 'AccessModeViolationError';
    this.adapterId = adapterId;
    this.resource = resource;
    this.mode = mode;
  }
}

/**
 * Throw `AccessModeViolationError` unless the registry allows `adapterId` to use `resource` in
 * `mode`: a mode of `none`, a missing or disabled row, a registry mode of `none`, a mode other than
 * the registered one, or a non-`user_supplied` mode without a counsel note are all refused.
 */
export async function assertAccessMode(
  adapterId: string,
  resource: Resource,
  mode: AccessMode,
  deps?: AccessModeDeps,
): Promise<void> {
  if (!ResourceSchema.safeParse(resource).success || !AccessModeSchema.safeParse(mode).success) {
    throw new AccessModeViolationError('unknown-mode', adapterId, resource, mode);
  }
  if (mode === 'none') throw new AccessModeViolationError('mode-none', adapterId, resource, mode);
  try {
    await assertRegistryAccessMode({ adapterId, resource, requestedMode: mode }, deps);
  } catch (error) {
    if (error instanceof AccessModeError) {
      throw new AccessModeViolationError(error.reason, adapterId, resource, mode);
    }
    throw error;
  }
}

/** `assertAccessMode` with the mode the adapter declares for `resource`. */
export async function assertAdapterAccess(
  adapter: Pick<CourtAdapter, 'id' | 'accessModes'>,
  resource: Resource,
  deps?: AccessModeDeps,
): Promise<void> {
  await assertAccessMode(adapter.id, resource, adapter.accessModes[resource], deps);
}
