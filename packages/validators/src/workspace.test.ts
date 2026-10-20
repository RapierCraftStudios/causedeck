import { describe, expect, it } from 'vitest';

import {
  ChangeRoleInput,
  CreateWorkspaceInput,
  InviteInput,
  RESERVED_SLUGS,
  Slug,
  UpdateRoleSettingsInput,
  UpdateWorkspaceProfileInput,
} from './workspace';

describe('UpdateRoleSettingsInput', () => {
  it('accepts both role settings as booleans', () => {
    const input = { advocatesCanInvite: false, ownersSeeRestrictedMatters: true };
    expect(UpdateRoleSettingsInput.parse(input)).toEqual(input);
  });

  it('rejects a missing, non-boolean or unknown setting', () => {
    expect(UpdateRoleSettingsInput.safeParse({ advocatesCanInvite: true }).success).toBe(false);
    expect(
      UpdateRoleSettingsInput.safeParse({
        advocatesCanInvite: 'false',
        ownersSeeRestrictedMatters: true,
      }).success,
    ).toBe(false);
    expect(
      UpdateRoleSettingsInput.safeParse({
        advocatesCanInvite: true,
        ownersSeeRestrictedMatters: true,
        advocatesCanReadAudit: false,
      }).success,
    ).toBe(false);
  });
});

describe('Slug', () => {
  it('accepts lowercase hyphenated slugs', () => {
    expect(Slug.parse('chennai-chambers-2')).toBe('chennai-chambers-2');
  });

  it.each(['Chennai', 'ab', '-lead', 'trail-', 'double--dash', 'with space', 'a'.repeat(49)])(
    'rejects %j',
    (value) => {
      expect(Slug.safeParse(value).success).toBe(false);
    },
  );

  it.each(RESERVED_SLUGS)('rejects the reserved slug %j', (value) => {
    expect(Slug.safeParse(value).success).toBe(false);
  });
});

describe('CreateWorkspaceInput', () => {
  it('requires a non-blank name and defaults kind to solo', () => {
    expect(CreateWorkspaceInput.safeParse({}).success).toBe(false);
    expect(CreateWorkspaceInput.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateWorkspaceInput.parse({ name: ' Iyer Chambers ' })).toEqual({
      name: 'Iyer Chambers',
      kind: 'solo',
    });
  });
});

describe('InviteInput', () => {
  it('lowercases the email and refuses the owner role', () => {
    expect(InviteInput.parse({ email: 'A@Example.com', role: 'clerk' })).toEqual({
      email: 'a@example.com',
      role: 'clerk',
    });
    expect(InviteInput.safeParse({ email: 'a@example.com', role: 'owner' }).success).toBe(false);
  });
});

describe('ChangeRoleInput', () => {
  it('needs a member uuid and a known role', () => {
    const memberId = '7f1c6b1e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
    expect(ChangeRoleInput.parse({ memberId, role: 'owner' })).toEqual({ memberId, role: 'owner' });
    expect(ChangeRoleInput.safeParse({ memberId, role: 'partner' }).success).toBe(false);
    expect(ChangeRoleInput.safeParse({ memberId: 'x', role: 'junior' }).success).toBe(false);
  });
});

describe('UpdateWorkspaceProfileInput', () => {
  const valid = {
    name: ' Iyer Chambers ',
    kind: 'chamber',
    timezone: 'Asia/Kolkata',
    locale: 'ta',
    practiceCity: ' Chennai ',
  };

  it('trims the name and city and keeps the other fields', () => {
    expect(UpdateWorkspaceProfileInput.parse(valid)).toEqual({
      name: 'Iyer Chambers',
      kind: 'chamber',
      timezone: 'Asia/Kolkata',
      locale: 'ta',
      practiceCity: 'Chennai',
    });
  });

  it('turns an empty practice city into null', () => {
    expect(UpdateWorkspaceProfileInput.parse({ ...valid, practiceCity: '  ' }).practiceCity).toBe(
      null,
    );
    expect(UpdateWorkspaceProfileInput.parse({ ...valid, practiceCity: null }).practiceCity).toBe(
      null,
    );
  });

  it.each([
    { name: '  ' },
    { name: 'x'.repeat(121) },
    { kind: 'firm' },
    { timezone: 'Mars/Olympus' },
    { timezone: '' },
    { locale: 'fr' },
    { practiceCity: 'x'.repeat(81) },
    { slug: 'Not A Slug' },
    { slug: 'settings' },
  ])('rejects %j', (patch) => {
    expect(UpdateWorkspaceProfileInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('accepts an optional valid slug', () => {
    expect(UpdateWorkspaceProfileInput.parse({ ...valid, slug: 'iyer-chambers' }).slug).toBe(
      'iyer-chambers',
    );
  });
});
