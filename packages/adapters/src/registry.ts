// Adapter registry (#369): adapters register once at start-up; callers resolve one by id or by the
// forum code a document belongs to. In memory and synchronous: versioned config with hot deploy is
// #372. `createAdapterRegistry` gives tests an isolated instance.
import { CourtAdapterDescriptorSchema, type CourtAdapter } from './types.ts';

export interface AdapterRegistry {
  register(adapter: CourtAdapter): void;
  resolveById(id: string): CourtAdapter | undefined;
  resolveByForum(forumCode: string): CourtAdapter | undefined;
  listAdapters(): CourtAdapter[];
}

export class AdapterRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterRegistrationError';
  }
}

export function createAdapterRegistry(): AdapterRegistry {
  const byId = new Map<string, CourtAdapter>();
  const byForum = new Map<string, CourtAdapter>();
  return {
    register(adapter) {
      const descriptor = CourtAdapterDescriptorSchema.safeParse({
        id: adapter.id,
        version: adapter.version,
        forumCodes: [...adapter.forumCodes],
        accessModes: adapter.accessModes,
      });
      if (!descriptor.success) {
        throw new AdapterRegistrationError(
          `Invalid adapter ${adapter.id}: ${descriptor.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
      if (byId.has(adapter.id)) {
        throw new AdapterRegistrationError(`Adapter ${adapter.id} is already registered`);
      }
      const taken = adapter.forumCodes.find((code) => byForum.has(code));
      if (taken !== undefined) {
        throw new AdapterRegistrationError(
          `Forum ${taken} already has adapter ${byForum.get(taken)?.id ?? ''}`,
        );
      }
      byId.set(adapter.id, adapter);
      for (const code of adapter.forumCodes) byForum.set(code, adapter);
    },
    resolveById: (id) => byId.get(id),
    resolveByForum: (forumCode) => byForum.get(forumCode),
    listAdapters: () => [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

const defaultRegistry = createAdapterRegistry();

/** Register an adapter in the process-wide registry; a duplicate id or forum code throws. */
export const register = (adapter: CourtAdapter): void => {
  defaultRegistry.register(adapter);
};
export const resolveById = (id: string): CourtAdapter | undefined =>
  defaultRegistry.resolveById(id);
export const resolveByForum = (forumCode: string): CourtAdapter | undefined =>
  defaultRegistry.resolveByForum(forumCode);
export const listAdapters = (): CourtAdapter[] => defaultRegistry.listAdapters();
