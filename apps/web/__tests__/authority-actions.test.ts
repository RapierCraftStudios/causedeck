// The drafting studio authority actions (#1144): with `copilot.enabled` off both are NOT_FOUND and the
// core services are never reached; with it on they delegate to `proposeAuthorities` /
// `insertAuthority` as the member, with the candidate ref sent unaltered, and a core domain error
// comes back as its client-safe code. The session/membership guard is the shared `workspaceAction`
// (covered by workspace-action.test.ts and the cross-tenant suite); here it runs the handler with a
// fixed member context.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';

import { ActionError, type Result } from '../lib/safe-action.ts';

const state = vi.hoisted(() => ({ flagOn: true }));
const core = vi.hoisted(() => ({ proposeAuthorities: vi.fn(), insertAuthority: vi.fn() }));
const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const TX = { scoped: true };

vi.mock('@causedeck/flags/server', () => {
  class FlagOffError extends Error {}
  return {
    requireFlag: vi.fn((key: string) =>
      key === 'copilot.enabled' && state.flagOn
        ? Promise.resolve()
        : Promise.reject(new FlagOffError(key)),
    ),
    isFlagOffError: (error: unknown) => error instanceof FlagOffError,
  };
});
vi.mock('@causedeck/core/drafting', () => core);
vi.mock('../lib/workspace-action.ts', async (original) => {
  const real = await original<Record<string, unknown>>();
  return {
    ...real,
    workspaceAction:
      <I, O>(schema: ZodType<I>, handler: (input: I, ctx: unknown) => Promise<O>) =>
      async (raw: unknown): Promise<Result<O>> => {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return { ok: false, error: { code: 'VALIDATION', message: '' } };
        try {
          return {
            ok: true,
            data: await handler(parsed.data, { workspaceId: WS, userId: USER, tx: TX }),
          };
        } catch (error) {
          if (error instanceof ActionError) {
            return { ok: false, error: { code: error.code, message: error.message } };
          }
          throw error;
        }
      },
  };
});

const { insertAuthorityAction, proposeAuthoritiesAction } =
  await import('../app/(app)/w/[slug]/drafts/[id]/authority-actions.ts');

const DRAFT = '00000000-0000-4000-8000-0000000d0001';
const VERSION = '00000000-0000-4000-8000-0000000d0002';
const JUDGMENT = '00000000-0000-4000-8000-0000000e0001';
const REF = { judgmentId: JUDGMENT, quote: 'no written consent was taken', para: 12 };

const proposeInput = { workspaceId: WS, draftId: DRAFT, blockId: 'b.1' };
const insertInput = {
  workspaceId: WS,
  draftId: DRAFT,
  versionId: VERSION,
  afterBlockId: 'b.1',
  candidateRef: REF,
};

const code = (result: Result<unknown>) => (result.ok ? null : result.error.code);

beforeEach(() => {
  state.flagOn = true;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('authority actions with copilot.enabled off', () => {
  it('are NOT_FOUND and never reach the core services', async () => {
    state.flagOn = false;
    expect(code(await proposeAuthoritiesAction(proposeInput))).toBe('NOT_FOUND');
    expect(code(await insertAuthorityAction(insertInput))).toBe('NOT_FOUND');
    expect(core.proposeAuthorities).not.toHaveBeenCalled();
    expect(core.insertAuthority).not.toHaveBeenCalled();
  });
});

describe('authority actions with copilot.enabled on', () => {
  it('proposes for the block as the member', async () => {
    const proposal = {
      candidates: [],
      noAuthority: true,
      aiBlocked: false,
      usage: { used: 1, limit: 30 },
    };
    core.proposeAuthorities.mockResolvedValue(proposal);
    const result = await proposeAuthoritiesAction(proposeInput);
    expect(result).toEqual({ ok: true, data: proposal });
    expect(core.proposeAuthorities).toHaveBeenCalledWith(
      { db: TX },
      { workspaceId: WS, userId: USER },
      { draftId: DRAFT, blockId: 'b.1' },
    );
  });

  it('inserts with the candidate ref exactly as sent and returns the new version', async () => {
    core.insertAuthority.mockResolvedValue({
      version: { id: 'v2', versionNo: 2 },
      blockId: 'auth-1234abcd',
    });
    const result = await insertAuthorityAction(insertInput);
    expect(result).toEqual({
      ok: true,
      data: { versionId: 'v2', versionNo: 2, blockId: 'auth-1234abcd' },
    });
    expect(core.insertAuthority).toHaveBeenCalledWith(
      { db: TX },
      { workspaceId: WS, userId: USER },
      { draftId: DRAFT, versionId: VERSION, afterBlockId: 'b.1', candidateRef: REF },
    );
  });

  it('rejects a ref with extra fields before the core is reached', async () => {
    const result = await insertAuthorityAction({
      ...insertInput,
      candidateRef: { ...REF, verified: true },
    });
    expect(code(result)).toBe('VALIDATION');
    expect(core.insertAuthority).not.toHaveBeenCalled();
  });

  it('returns a stale version as CONFLICT', async () => {
    core.insertAuthority.mockRejectedValue(
      Object.assign(new Error('The draft changed; reload'), {
        name: 'WorkspaceError',
        code: 'CONFLICT',
      }),
    );
    expect(code(await insertAuthorityAction(insertInput))).toBe('CONFLICT');
  });
});
