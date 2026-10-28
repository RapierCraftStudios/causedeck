// The outward provider (#736): importing it registers 'outward'; each draft becomes a card with
// copy, WhatsApp and email hand-offs, and "mark sent" records a share.
import { describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  listDrafts: vi.fn(),
  getDraft: vi.fn(),
  recordShared: vi.fn(),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
vi.mock('@causedeck/core/runtime', () => ({
  inWorkspace: (_scope: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('@causedeck/core/outward', () => core);

const scope = { workspaceId: 'w', userId: 'u' };

describe('outward ready provider', () => {
  it('registers under the id outward and maps drafts to cards', async () => {
    await import('../../lib/outward/ready-provider.ts');
    const { readyProviders } = await import('../../lib/inbox/ready-providers.ts');
    const provider = readyProviders().find((p) => p.id === 'outward');
    if (!provider) throw new Error('outward provider not registered');
    core.listDrafts.mockResolvedValue([{ id: 'd1' }]);
    core.getDraft.mockResolvedValue({
      id: 'd1',
      matterTitle: 'A v B',
      audience: 'client',
      language: 'en',
      body: 'Hello & bye',
    });
    const [item] = await provider.list(scope);
    expect(item?.title).toBe('A v B');
    const hrefs = item?.actions.flatMap((a) => (a.kind === 'open' ? [a.href] : [])) ?? [];
    expect(hrefs[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(hrefs[1]).toMatch(/^mailto:\?subject=/);
    expect(item?.actions[0]).toMatchObject({ kind: 'copy', text: 'Hello & bye' });
  });

  it('records a clipboard share when marked sent', async () => {
    await import('../../lib/outward/ready-provider.ts');
    const { readyProviders } = await import('../../lib/inbox/ready-providers.ts');
    const provider = readyProviders().find((p) => p.id === 'outward');
    if (!provider) throw new Error('outward provider not registered');
    await provider.markSent(scope, 'd1');
    expect(core.recordShared).toHaveBeenCalledWith({ db: {} }, scope, {
      draftId: 'd1',
      channel: 'clipboard',
    });
  });
});
