import { describe, expect, it } from 'vitest';

import {
  ChangeRoleInput,
  CreateWorkspaceInput,
  InviteInput,
  RESERVED_SLUGS,
  Slug,
} from './workspace';

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
