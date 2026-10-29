import { describe, expect, it } from 'vitest';

import {
  CHAMBER_STEPS,
  CourtsStepInput,
  DEFAULT_DELEGATION_DEFAULTS,
  InviteStepInput,
  OnboardingStepEvent,
  ProfileStepInput,
  SOLO_STEPS,
  isSkippable,
  isStepOf,
  nextStepOf,
  previousStepOf,
  readDelegationDefaults,
} from './onboarding';

describe('onboarding steps', () => {
  it('keeps the solo path within seven steps and ends on done', () => {
    expect(SOLO_STEPS.length).toBeLessThanOrEqual(7);
    expect(SOLO_STEPS.at(-1)).toBe('done');
    expect(CHAMBER_STEPS.at(-1)).toBe('done');
  });

  it('walks forward and back, and stops at the ends', () => {
    expect(nextStepOf('solo', 'workspace')).toBe('profile');
    expect(nextStepOf('solo', 'done')).toBeNull();
    expect(previousStepOf('solo', 'workspace')).toBeNull();
    expect(previousStepOf('chamber', 'roles')).toBe('invite');
  });

  it('knows which steps belong to which path', () => {
    expect(isStepOf('solo', 'invite')).toBe(false);
    expect(isStepOf('chamber', 'invite')).toBe(true);
  });

  it('lets import be skipped but not the profile', () => {
    expect(isSkippable('solo', 'import')).toBe(true);
    expect(isSkippable('solo', 'profile')).toBe(false);
  });
});

describe('onboarding payloads', () => {
  const profile = {
    enrolmentNumber: 'MS/1234/2019',
    barCouncil: 'tamil_nadu_puducherry',
    practiceAreas: ['civil'],
    languages: ['en', 'ta'],
  };

  it('accepts a complete profile and rejects a bad enrolment number or unknown council', () => {
    expect(ProfileStepInput.safeParse(profile).success).toBe(true);
    expect(ProfileStepInput.safeParse({ ...profile, enrolmentNumber: '!' }).success).toBe(false);
    expect(ProfileStepInput.safeParse({ ...profile, barCouncil: 'mars' }).success).toBe(false);
    expect(ProfileStepInput.safeParse({ ...profile, practiceAreas: [] }).success).toBe(false);
    expect(ProfileStepInput.safeParse({ ...profile, extra: 1 }).success).toBe(false);
  });

  it('requires at least one court code', () => {
    expect(CourtsStepInput.safeParse({ forumCodes: [] }).success).toBe(false);
    expect(
      CourtsStepInput.safeParse({ forumCodes: ['in.tn.madras-hc.principal.original'] }).success,
    ).toBe(true);
  });

  it('lowercases invited emails and refuses the owner role', () => {
    const ok = InviteStepInput.parse({
      invites: [{ email: 'Junior@Example.Test', role: 'junior' }],
    });
    expect(ok.invites[0]?.email).toBe('junior@example.test');
    expect(
      InviteStepInput.safeParse({ invites: [{ email: 'a@b.test', role: 'owner' }] }).success,
    ).toBe(false);
  });

  it('falls back to the starting delegation defaults for unreadable values', () => {
    expect(readDelegationDefaults({})).toEqual(DEFAULT_DELEGATION_DEFAULTS);
    expect(
      readDelegationDefaults({ ...DEFAULT_DELEGATION_DEFAULTS, notifyAssignee: false }),
    ).toEqual({
      ...DEFAULT_DELEGATION_DEFAULTS,
      notifyAssignee: false,
    });
  });

  it('carries no content in the telemetry event', () => {
    expect(
      OnboardingStepEvent.safeParse({
        name: 'onboarding.step.completed',
        path: 'solo',
        step: 'profile',
        skipped: false,
      }).success,
    ).toBe(true);
    expect(
      OnboardingStepEvent.safeParse({
        name: 'onboarding.step.completed',
        path: 'solo',
        step: 'profile',
        skipped: false,
        email: 'x@y.test',
      }).success,
    ).toBe(false);
  });
});
