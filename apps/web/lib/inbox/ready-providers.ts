// "Ready to send" sources (#48). Outward drafts the lawyer must send themselves (L4) arrive later
// (#69): each source registers a `ReadyItemProvider` here and the inbox lists whatever the
// registered providers return. The registry is empty until then. Items carry only hand-offs the
// provider defines (copy, open in the person's own app) and the "Mark as sent by me" log; nothing
// in the inbox sends, files or pays anything.
//
// The locally queued captures of the offline outbox (#50) come through the same kind of registry on
// the client (`registerOutboxSource`), empty until the outbox exists.

export type ReadyAction =
  | { id: string; kind: 'copy'; text: string }
  | { id: string; kind: 'open'; app: string; href: string };

export interface ReadyItem {
  id: string;
  providerId: string;
  title: string;
  /** Who it is for and what; never a promise that anything will be sent. */
  summary: string;
  actions: ReadyAction[];
}

export interface ReadyScope {
  workspaceId: string;
  userId: string;
}

export interface ReadyItemProvider {
  id: string;
  list(scope: ReadyScope): Promise<ReadyItem[]>;
  /** Log that the lawyer sent it themselves. */
  markSent(scope: ReadyScope, itemId: string): Promise<void>;
}

const providers = new Map<string, ReadyItemProvider>();

export function registerReadyProvider(provider: ReadyItemProvider): void {
  providers.set(provider.id, provider);
}

export function readyProviders(): ReadyItemProvider[] {
  return [...providers.values()];
}

/** Every registered provider's items. A provider that fails contributes nothing. */
export async function listReadyItems(scope: ReadyScope): Promise<ReadyItem[]> {
  const lists = await Promise.all(
    readyProviders().map((provider) => provider.list(scope).catch((): ReadyItem[] => [])),
  );
  return lists.flat();
}

/** Log "sent by me" through the provider that owns the item; false when there is none. */
export async function markReadySent(
  scope: ReadyScope,
  providerId: string,
  itemId: string,
): Promise<boolean> {
  const provider = providers.get(providerId);
  if (provider === undefined) return false;
  await provider.markSent(scope, itemId);
  return true;
}

/** A capture saved on this device and waiting to upload (#50 fills this). */
export interface LocalCapture {
  id: string;
  channel: string;
  createdAt: string;
}

type OutboxSource = () => LocalCapture[];

const outboxSources = new Map<string, OutboxSource>();

export function registerOutboxSource(id: string, source: OutboxSource): void {
  outboxSources.set(id, source);
}

export function localCaptures(): LocalCapture[] {
  return [...outboxSources.values()].flatMap((source) => source());
}
