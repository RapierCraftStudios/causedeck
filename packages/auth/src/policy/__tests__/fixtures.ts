import type { Role } from '../../roles';
import type { Actor, Resource } from '../can';

export const WS = 'ws-a';
export const OTHER_WS = 'ws-b';

export function actor(role: Role, overrides: Partial<Actor> = {}): Actor {
  return { userId: `user-${role}`, workspaceId: WS, role, ...overrides };
}

export function matter(overrides: Partial<Resource> = {}): Resource {
  return { kind: 'matter', workspaceId: WS, matterId: 'matter-1', ...overrides };
}
