// The onboarding wizard services (#92), against the real test database under FORCE RLS: resumable
// state per member and workspace, step order and skipping, the M1 profile saved as confirmed
// `manual` memory (idempotent), the chamber defaults and the brief format reaching the first
// brief, and cross-tenant isolation (a member of two workspaces cannot read or advance the other's).
import { schema } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { codeOf, inWorld, type World } from '../__tests__/memory-world.ts';
import { createBriefMemoryProvider } from '../briefs/index.ts';
import { listMemory } from '../memory/index.ts';

import {
  completeOnboardingStep,
  findResumableOnboarding,
  getChamberDefaults,
  getFirstCourtDay,
  getOnboardingState,
  saveChamberBriefFormat,
  saveChamberDelegation,
  saveOnboardingCourts,
  saveOnboardingProfile,
  startOnboarding,
} from './index.ts';

const PROFILE = {
  enrolmentNumber: 'MS/1234/2019',
  barCouncil: 'tamil_nadu_puducherry',
  practiceAreas: ['civil', 'writ'],
  languages: ['en', 'ta'],
};

/** A's owner with the two-tenant onboarding seed row removed, so a test starts from nothing. */
async function fresh(w: World) {
  await inWorkspace(w.tx, w.a.id, (s) => s.delete(schema.onboardingState));
  return w.owner;
}

describe('onboarding state', () => {
  it('starts once, resumes at the same step and never resets on a second start', async () => {
    await inWorld(async (w) => {
      const actor = await fresh(w);
      expect(await getOnboardingState(w.tx, actor)).toBeNull();
      const started = await startOnboarding(w.tx, actor, { path: 'solo' });
      expect(started).toMatchObject({ path: 'solo', step: 'profile', completed: ['workspace'] });
      await completeOnboardingStep(w.tx, actor, { step: 'profile' });
      const again = await startOnboarding(w.tx, actor, { path: 'chamber' });
      expect(again).toMatchObject({ path: 'solo', step: 'courts' });
      expect(await getOnboardingState(w.tx, actor)).toMatchObject({ step: 'courts' });
    });
  });

  it('completes a step idempotently and moves the resume point forward only', async () => {
    await inWorld(async (w) => {
      const actor = await fresh(w);
      await startOnboarding(w.tx, actor, { path: 'solo' });
      const first = await completeOnboardingStep(w.tx, actor, { step: 'profile' });
      expect(first.next).toBe('courts');
      expect(first.event).toEqual({
        name: 'onboarding.step.completed',
        path: 'solo',
        step: 'profile',
        skipped: false,
      });
      const repeat = await completeOnboardingStep(w.tx, actor, { step: 'profile' });
      expect(repeat.state.completed).toEqual(['workspace', 'profile']);
      expect(repeat.state.step).toBe('courts');
    });
  });

  it('refuses to jump ahead, unknown steps and skipping a required step', async () => {
    await inWorld(async (w) => {
      const actor = await fresh(w);
      await startOnboarding(w.tx, actor, { path: 'solo' });
      expect(await codeOf(completeOnboardingStep(w.tx, actor, { step: 'import' }))).toBe(
        'VALIDATION',
      );
      expect(await codeOf(completeOnboardingStep(w.tx, actor, { step: 'invite' }))).toBe(
        'VALIDATION',
      );
      expect(
        await codeOf(completeOnboardingStep(w.tx, actor, { step: 'profile', skipped: true })),
      ).toBe('VALIDATION');
    });
  });

  it('lets import be skipped and finishes on done', async () => {
    await inWorld(async (w) => {
      const actor = await fresh(w);
      await startOnboarding(w.tx, actor, { path: 'solo' });
      for (const step of ['profile', 'courts']) await completeOnboardingStep(w.tx, actor, { step });
      const skipped = await completeOnboardingStep(w.tx, actor, { step: 'import', skipped: true });
      expect(skipped.state.skipped).toEqual(['import']);
      await completeOnboardingStep(w.tx, actor, { step: 'confirm', skipped: true });
      const done = await completeOnboardingStep(w.tx, actor, { step: 'done' });
      expect(done).toMatchObject({ next: null, state: { finished: true } });
      expect(await findResumableOnboarding(w.tx, actor.userId)).toBeNull();
    });
  });

  it('finds the unfinished wizard across the user’s workspaces', async () => {
    await inWorld(async (w) => {
      const actor = await fresh(w);
      await startOnboarding(w.tx, actor, { path: 'chamber' });
      const found = await findResumableOnboarding(w.tx, actor.userId);
      expect(found).toMatchObject({ workspaceId: w.a.id, state: { path: 'chamber' } });
    });
  });

  it('keeps one workspace’s state out of reach of a member of another', async () => {
    await inWorld(async (w) => {
      await fresh(w);
      await startOnboarding(w.tx, w.owner, { path: 'solo' });
      // B's owner names A's workspace: refused, and A's row is unchanged.
      const intruder = { userId: w.ownerB.userId, workspaceId: w.a.id };
      expect(await codeOf(getOnboardingState(w.tx, intruder))).toBe('NOT_FOUND');
      expect(await codeOf(startOnboarding(w.tx, intruder, { path: 'solo' }))).toBe('NOT_FOUND');
      expect(await codeOf(completeOnboardingStep(w.tx, intruder, { step: 'profile' }))).toBe(
        'NOT_FOUND',
      );
      expect(await getOnboardingState(w.tx, w.owner)).toMatchObject({ step: 'profile' });
      // B's own owner sees only B's seeded row (no A state), and has no progress on A.
      expect(await getOnboardingState(w.tx, w.ownerB)).toMatchObject({ step: 'profile' });
    });
  });
});

describe('onboarding profile (M1)', () => {
  it('saves the profile as confirmed manual memory and repeats without duplicating', async () => {
    await inWorld(async (w) => {
      await saveOnboardingProfile(w.deps, w.owner, PROFILE);
      await saveOnboardingProfile(w.deps, w.owner, { ...PROFILE, languages: ['en'] });
      const items = await listMemory(w.deps, w.owner, { layers: ['M1'] });
      const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
      expect(items).toHaveLength(4);
      expect(byKey['M1.enrolment_number']).toMatchObject({ value: 'MS/1234/2019' });
      expect(byKey['M1.bar_council']).toMatchObject({ value: 'tamil_nadu_puducherry' });
      expect(byKey['M1.practice_areas']).toMatchObject({ value: ['civil', 'writ'] });
      expect(byKey['M1.languages']).toMatchObject({ value: ['en'] });
      for (const item of items) expect(item.sourceType).toBe('manual');
      const [profile] = await inWorkspace(w.tx, w.a.id, (s) =>
        s
          .select()
          .from(schema.advocateProfile)
          .where(
            and(
              eq(schema.advocateProfile.workspaceId, w.a.id),
              eq(schema.advocateProfile.userId, w.owner.userId),
            ),
          ),
      );
      expect(profile?.enrolmentNumbers.filter((n) => n === 'MS/1234/2019')).toHaveLength(1);
    });
  });

  it('rejects an invalid profile and a non-member', async () => {
    await inWorld(async (w) => {
      expect(
        await codeOf(saveOnboardingProfile(w.deps, w.owner, { ...PROFILE, enrolmentNumber: '' })),
      ).toBe('VALIDATION');
      expect(
        await codeOf(
          saveOnboardingProfile(w.deps, { userId: w.ownerB.userId, workspaceId: w.a.id }, PROFILE),
        ),
      ).toBe('NOT_FOUND');
    });
  });

  it('saves catalogue courts and refuses a forum code that does not exist', async () => {
    await inWorld(async (w) => {
      const [forum] = await inWorkspace(w.tx, w.a.id, (s) =>
        s.select().from(schema.forum).limit(1),
      );
      expect(forum).toBeDefined();
      await saveOnboardingCourts(w.deps, w.owner, { forumCodes: [forum?.code ?? ''] });
      const items = await listMemory(w.deps, w.owner, { layers: ['M1'] });
      expect(items.find((item) => item.key === 'M1.courts')?.value).toEqual([forum?.code]);
      expect(
        await codeOf(saveOnboardingCourts(w.deps, w.owner, { forumCodes: ['no.such.forum'] })),
      ).toBe('NOT_FOUND');
    });
  });
});

describe('chamber defaults', () => {
  it('saves delegation defaults and the brief format, and the first brief uses the format', async () => {
    await inWorld(async (w) => {
      const defaults = {
        suggestAssignments: false,
        defaultCapacity: 'arguing',
        notifyAssignee: true,
      };
      await saveChamberDelegation(w.tx, w.owner, defaults);
      await saveChamberBriefFormat(w.deps, w.owner, { briefFormat: 'short' });
      expect(await getChamberDefaults(w.tx, w.owner)).toEqual({
        delegation: defaults,
        briefFormat: 'short',
      });
      const provider = createBriefMemoryProvider(w.deps);
      // The owner has their own M2 format; a junior with none gets the chamber default.
      expect(
        (await provider.format({ workspaceId: w.a.id, userId: w.owner.userId, matterId: w.m1 }))
          ?.verbosity,
      ).toBe('short');
      expect(
        (await provider.format({ workspaceId: w.a.id, userId: w.asJunior.userId, matterId: w.m1 }))
          ?.verbosity,
      ).toBe('short');
    });
  });

  it('refuses a clerk and an invalid format', async () => {
    await inWorld(async (w) => {
      expect(
        await codeOf(saveChamberBriefFormat(w.deps, w.asClerk, { briefFormat: 'short' })),
      ).toBe('FORBIDDEN');
      expect(await codeOf(saveChamberBriefFormat(w.deps, w.owner, { briefFormat: 'huge' }))).toBe(
        'VALIDATION',
      );
      expect(
        await codeOf(saveChamberDelegation(w.tx, w.owner, { suggestAssignments: 'yes' })),
      ).toBe('VALIDATION');
    });
  });
});

describe('first court day', () => {
  it('has no day when nothing is listed on or after today', async () => {
    await inWorld(async (w) => {
      const far = new Date('2100-01-01T00:00:00Z');
      const day = await getFirstCourtDay(w.tx, w.owner, far);
      expect(day).toMatchObject({ date: null, briefs: 0 });
      expect(day.openObligations).toBeGreaterThanOrEqual(0);
    });
  });

  it('finds the earliest listed day from today on, with one brief per listing', async () => {
    await inWorld(async (w) => {
      const past = new Date('2000-01-01T00:00:00Z');
      const day = await getFirstCourtDay(w.tx, w.owner, past);
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.briefs).toBeGreaterThanOrEqual(1);
    });
  });

  it('refuses a member of another workspace', async () => {
    await inWorld(async (w) => {
      expect(
        await codeOf(getFirstCourtDay(w.tx, { userId: w.ownerB.userId, workspaceId: w.a.id })),
      ).toBe('NOT_FOUND');
    });
  });
});
