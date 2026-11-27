// @vitest-environment jsdom
// Judgment actions (#1176): the server actions (targets loaded as the member, a role without
// `draft.write`/`memory.read` gets no drafts/notes, save pins the judgment on a new or chosen note,
// insert is NOT_FOUND with `copilot.enabled` off and otherwise delegates to core `insertAuthority`
// with the quote unaltered, a re-verification failure comes back as its client-safe code) and the
// client component (copy citation with pinpoint, insert only with a passage, save and insert flows,
// the not-verified message, the copilot link with the judgment in context). The session/membership
// guard is the shared `workspaceAction` (cross-tenant suite); here it runs with a fixed member.
import type { Role } from '@causedeck/auth/policy';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';

import { ActionError, type Result } from '../lib/safe-action.ts';

import { catalogs } from './helpers/intl.ts';

const state = vi.hoisted((): { flagOn: boolean; role: Role } => ({
  flagOn: true,
  role: 'advocate',
}));
const core = vi.hoisted(() => ({
  insertAuthority: vi.fn(),
  listDrafts: vi.fn(),
  getDraft: vi.fn(),
  listMatters: vi.fn(),
  listNotes: vi.fn(),
  createNote: vi.fn(),
  addAuthority: vi.fn(),
}));
const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const TX = { scoped: true };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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
vi.mock('@causedeck/core/drafting', () => ({
  insertAuthority: core.insertAuthority,
  listDrafts: core.listDrafts,
  getDraft: core.getDraft,
}));
vi.mock('@causedeck/core/matter-graph', () => ({ listMatters: core.listMatters }));
vi.mock('@causedeck/core/research', () => ({
  listNotes: core.listNotes,
  createNote: core.createNote,
  addAuthority: core.addAuthority,
}));
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
            data: await handler(parsed.data, {
              workspaceId: WS,
              userId: USER,
              role: state.role,
              tx: TX,
            }),
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

const actions = await import('../app/(app)/w/[slug]/research/judgment-actions.ts');
const { JudgmentActions, citationText, copilotHref } =
  await import('../components/research/judgment-actions.tsx');

const MATTER = '00000000-0000-4000-8000-0000000c0001';
const NOTE = '00000000-0000-4000-8000-0000000c0002';
const DRAFT = '00000000-0000-4000-8000-0000000d0001';
const VERSION = '00000000-0000-4000-8000-0000000d0002';
const JUDGMENT = '00000000-0000-4000-8000-0000000e0001';
const QUOTE = 'no written consent was taken';
const ACTOR = { workspaceId: WS, userId: USER };
const t = catalogs.en.research.actions;

const code = (result: Result<unknown>) => (result.ok ? null : result.error.code);
const domainError = (errorCode: string) =>
  Object.assign(new Error('refused'), { name: 'WorkspaceError', code: errorCode });

const insertInput = {
  workspaceId: WS,
  draftId: DRAFT,
  versionId: VERSION,
  afterBlockId: 'b.1',
  judgmentId: JUDGMENT,
  quote: QUOTE,
  para: 12,
  page: 3,
};

beforeEach(() => {
  state.flagOn = true;
  state.role = 'advocate';
  core.listMatters.mockResolvedValue({ items: [{ id: MATTER, title: 'Rao v. State' }] });
  core.listNotes.mockResolvedValue([{ id: NOTE, title: 'Consent' }]);
  core.listDrafts.mockResolvedValue([{ id: DRAFT, title: 'Written submissions' }]);
  core.getDraft.mockResolvedValue({
    version: {
      id: VERSION,
      blocks: [
        { type: 'heading', text: 'Facts' },
        { type: 'paragraph', text: 'The surgery went ahead.' },
      ],
    },
  });
  core.createNote.mockResolvedValue({ id: NOTE });
  core.addAuthority.mockResolvedValue({});
  core.insertAuthority.mockResolvedValue({ version: { versionNo: 4 }, blockId: 'b.2' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('judgment server actions', () => {
  it('loads the matters, then that matter’s notes and drafts with their blocks', async () => {
    const matters = await actions.loadActionTargetsAction({ workspaceId: WS });
    expect(matters).toEqual({
      ok: true,
      data: { matters: [{ id: MATTER, title: 'Rao v. State' }], notes: [], drafts: [] },
    });
    expect(core.listNotes).not.toHaveBeenCalled();

    const targets = await actions.loadActionTargetsAction({ workspaceId: WS, matterId: MATTER });
    expect(core.listNotes).toHaveBeenCalledWith(TX, ACTOR, MATTER);
    expect(core.listDrafts).toHaveBeenCalledWith({ db: TX }, ACTOR, { matterId: MATTER });
    expect(targets.ok && targets.data.notes).toEqual([{ id: NOTE, title: 'Consent' }]);
    const drafts = targets.ok ? targets.data.drafts : [];
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.versionId).toBe(VERSION);
    expect(drafts[0]?.blocks.map((b) => b.label)).toEqual(['Facts', 'The surgery went ahead.']);
  });

  it('gives a viewer neither notes nor drafts', async () => {
    state.role = 'viewer';
    const targets = await actions.loadActionTargetsAction({ workspaceId: WS, matterId: MATTER });
    expect(targets.ok && targets.data).toMatchObject({ notes: [], drafts: [] });
    expect(core.listNotes).not.toHaveBeenCalled();
    expect(core.listDrafts).not.toHaveBeenCalled();
  });

  it('maps another workspace’s matter to NOT_FOUND', async () => {
    core.listNotes.mockRejectedValue(domainError('NOT_FOUND'));
    const result = await actions.loadActionTargetsAction({ workspaceId: WS, matterId: MATTER });
    expect(code(result)).toBe('NOT_FOUND');
  });

  it('saves to a new note titled after the judgment, or to the chosen note', async () => {
    const base = {
      workspaceId: WS,
      matterId: MATTER,
      judgmentId: JUDGMENT,
      label: 'Rao v. State',
      citation: '2024 INSC 1, p. 3',
    };
    expect(await actions.saveJudgmentToNoteAction(base)).toEqual({
      ok: true,
      data: { matterId: MATTER, noteId: NOTE },
    });
    expect(core.createNote).toHaveBeenCalledWith(TX, ACTOR, {
      matterId: MATTER,
      title: 'Rao v. State',
    });
    expect(core.addAuthority).toHaveBeenCalledWith(TX, ACTOR, {
      matterId: MATTER,
      noteId: NOTE,
      authority: { label: 'Rao v. State', citation: '2024 INSC 1, p. 3' },
    });

    core.createNote.mockClear();
    await actions.saveJudgmentToNoteAction({ ...base, noteId: NOTE });
    expect(core.createNote).not.toHaveBeenCalled();
  });

  it('passes a role without memory.write through as FORBIDDEN', async () => {
    core.createNote.mockRejectedValue(domainError('FORBIDDEN'));
    const result = await actions.saveJudgmentToNoteAction({
      workspaceId: WS,
      matterId: MATTER,
      judgmentId: JUDGMENT,
      label: 'Rao v. State',
    });
    expect(code(result)).toBe('FORBIDDEN');
  });

  it('is NOT_FOUND with copilot.enabled off and never reaches insertAuthority', async () => {
    state.flagOn = false;
    expect(code(await actions.insertJudgmentIntoDraftAction(insertInput))).toBe('NOT_FOUND');
    expect(core.insertAuthority).not.toHaveBeenCalled();
  });

  it('delegates to insertAuthority with the quote unaltered', async () => {
    expect(await actions.insertJudgmentIntoDraftAction(insertInput)).toEqual({
      ok: true,
      data: { draftId: DRAFT, versionNo: 4, blockId: 'b.2' },
    });
    expect(core.insertAuthority).toHaveBeenCalledWith({ db: TX }, ACTOR, {
      draftId: DRAFT,
      versionId: VERSION,
      afterBlockId: 'b.1',
      candidateRef: { judgmentId: JUDGMENT, quote: QUOTE, para: 12, page: 3 },
    });
  });

  it('refuses a quote that no longer verifies (VALIDATION) and a stale version (CONFLICT)', async () => {
    core.insertAuthority.mockRejectedValueOnce(domainError('VALIDATION'));
    expect(code(await actions.insertJudgmentIntoDraftAction(insertInput))).toBe('VALIDATION');
    core.insertAuthority.mockRejectedValueOnce(domainError('CONFLICT'));
    expect(code(await actions.insertJudgmentIntoDraftAction(insertInput))).toBe('CONFLICT');
  });

  it('rejects unknown keys (strict input)', async () => {
    const result = await actions.insertJudgmentIntoDraftAction({ ...insertInput, verified: true });
    expect(code(result)).toBe('VALIDATION');
  });
});

describe('citation and copilot links', () => {
  it('appends the pinpoint to the citation', () => {
    expect(citationText('2024 INSC 1', 3, 12)).toBe('2024 INSC 1, p. 3, para 12');
    expect(citationText('2024 INSC 1', null, 0)).toBe('2024 INSC 1');
  });

  it('opens the matter copilot with the judgment in context', () => {
    expect(copilotHref('demo', MATTER, JUDGMENT)).toBe(
      `/w/demo/matters/${MATTER}/copilot?judgment=${JUDGMENT}`,
    );
  });
});

const renderActions = (quote: string | null = QUOTE) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <JudgmentActions
        workspaceId={WS}
        slug="demo"
        judgmentId={JUDGMENT}
        citation="2024 INSC 1"
        label="Rao v. State"
        quote={quote}
        page={3}
        para={12}
      />
    </NextIntlClientProvider>,
  );

const chooseMatter = async () => {
  const select = await screen.findByLabelText(t.matter);
  fireEvent.change(select, { target: { value: MATTER } });
};

describe('JudgmentActions', () => {
  it('copies the citation with its pinpoint', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderActions();
    fireEvent.click(screen.getByText(t.copy));
    expect(await screen.findByText(t.copied)).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('2024 INSC 1, p. 3, para 12');
  });

  it('offers no insert without a passage', () => {
    const { container } = renderActions(null);
    expect(
      container.querySelector<HTMLButtonElement>('[data-slot="judgment-insert"]')?.disabled,
    ).toBe(true);
  });

  it('saves to a new note on the chosen matter and links to its research tab', async () => {
    const { container } = renderActions();
    fireEvent.click(screen.getByText(t.save));
    await chooseMatter();
    await screen.findByLabelText(t.note);
    const submit = container.querySelector('[data-slot="judgment-save-submit"]');
    fireEvent.click(submit as Element);
    const saved = await screen.findByText(t.saved, { exact: false });
    expect(core.addAuthority).toHaveBeenCalledWith(TX, ACTOR, {
      matterId: MATTER,
      noteId: NOTE,
      authority: { label: 'Rao v. State', citation: '2024 INSC 1, p. 3, para 12' },
    });
    expect(saved.querySelector('a')?.getAttribute('href')).toBe(
      `/w/demo/matters/${MATTER}/research`,
    );
  });

  it('inserts after the last block, and says so when the quote no longer verifies', async () => {
    core.insertAuthority.mockRejectedValueOnce(domainError('VALIDATION'));
    const { container } = renderActions();
    fireEvent.click(screen.getByText(t.insert));
    await chooseMatter();
    await screen.findByLabelText(t.draft);
    // The form is hidden while an action is pending; wait for it to come back.
    const submit = async () => {
      const button = await waitFor(() => {
        const found = container.querySelector('[data-slot="judgment-insert-submit"]');
        expect(found).not.toBeNull();
        return found as Element;
      });
      fireEvent.click(button);
    };
    await submit();
    expect((await screen.findByRole('alert')).textContent).toBe(t.notVerified);
    expect(core.insertAuthority).toHaveBeenCalledWith({ db: TX }, ACTOR, {
      draftId: DRAFT,
      versionId: VERSION,
      afterBlockId: 'b.1',
      candidateRef: { judgmentId: JUDGMENT, quote: QUOTE, para: 12, page: 3 },
    });
    await submit();
    await waitFor(() => {
      expect(container.querySelector('[data-slot="judgment-inserted"]')).not.toBeNull();
    });
  });

  it('links to the matter copilot with the judgment once a matter is chosen', async () => {
    const { container } = renderActions();
    fireEvent.click(screen.getByText(t.ask));
    await chooseMatter();
    const link = container.querySelector('[data-slot="judgment-ask-link"]');
    expect(link?.getAttribute('href')).toBe(copilotHref('demo', MATTER, JUDGMENT));
    expect(core.listNotes).not.toHaveBeenCalled();
  });
});
