// SCIM v2 Users (#684, part of #508; RFC 7643 and 7644). The routes under `apps/web/app/api/scim`
// hand each request to `handleScim`, which checks the bearer token (`authenticateScimToken`), runs
// the operation in the token's workspace scope and turns failures into the SCIM error envelope.
// A SCIM user is a member of that workspace: its `id` is the user id, `userName` the email,
// `active` is `status = 'active'` and `roles[0]` the workspace role. DELETE marks the member
// `removed`; `active: false` suspends. Owners are never created or deprovisioned through SCIM.
import { isRole } from '@causedeck/auth/policy';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import {
  addProvisionedMember,
  deactivateProvisionedMember,
  WorkspaceError,
} from '../workspaces/index.ts';
import { DEFAULT_PROVISIONING_ROLE } from './csv.ts';
import { authenticateScimToken, type ScimIdentity } from './scim-token.ts';

type Queryable = Database | Transaction;

const { member, scimToken, user } = schema;

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCIM_CONFIG_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';

const MAX_PAGE = 200;

/** A failure with an HTTP status and an optional RFC 7644 `scimType`. */
export class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
    this.name = 'ScimError';
  }
}

export interface ScimResult {
  status: number;
  body?: unknown;
}

export interface ScimUser {
  schemas: [typeof SCIM_USER_SCHEMA];
  id: string;
  userName: string;
  displayName: string;
  name: { formatted: string };
  emails: { value: string; primary: true }[];
  active: boolean;
  roles: { value: string }[];
  meta: { resourceType: 'User'; created: string };
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  joinedAt: Date;
}

const userColumns = {
  id: user.id,
  email: user.email,
  name: user.name,
  role: member.role,
  status: member.status,
  joinedAt: member.joinedAt,
};

function toScimUser(row: UserRow): ScimUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: row.id,
    userName: row.email,
    displayName: row.name,
    name: { formatted: row.name },
    emails: [{ value: row.email, primary: true }],
    active: row.status === 'active',
    roles: [{ value: row.role }],
    meta: { resourceType: 'User', created: row.joinedAt.toISOString() },
  };
}

async function findUser(tx: Queryable, identity: ScimIdentity, userId: string): Promise<UserRow> {
  const [row] = await tx
    .select(userColumns)
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, identity.workspaceId),
        eq(member.userId, userId),
        ne(member.status, 'removed'),
      ),
    );
  if (!row) throw new ScimError(404, 'User not found');
  return row;
}

async function audit(
  tx: Queryable,
  identity: ScimIdentity,
  action: 'member.provisioned' | 'member.deprovisioned',
  userId: string,
  change: string,
): Promise<void> {
  await record(
    { db: tx, workspaceId: identity.workspaceId, actor: { userId: null, kind: 'api' } },
    {
      action,
      target: { kind: 'user', id: userId },
      metadata: { source: 'scim', change, tokenId: identity.tokenId },
    },
  );
}

const FILTER = /^userName\s+eq\s+"([^"]+)"$/i;

export interface ListScimUsersQuery {
  filter?: string | null;
  startIndex?: number | undefined;
  count?: number | undefined;
}

/** `GET /Users`: members that are not removed; the only filter is `userName eq "<email>"`. */
export async function listScimUsers(
  tx: Queryable,
  identity: ScimIdentity,
  query: ListScimUsersQuery = {},
): Promise<ScimResult> {
  let email: string | null = null;
  if (query.filter) {
    const match = FILTER.exec(query.filter.trim());
    if (!match?.[1])
      throw new ScimError(400, 'Only `userName eq "<value>"` is supported', 'invalidFilter');
    email = match[1].toLowerCase();
  }
  const startIndex = Math.max(1, Math.trunc(query.startIndex ?? 1));
  const count = Math.min(MAX_PAGE, Math.max(0, Math.trunc(query.count ?? 100)));
  const where = and(
    eq(member.organizationId, identity.workspaceId),
    ne(member.status, 'removed'),
    email === null ? undefined : eq(sql`lower(${user.email})`, email),
  );
  const [total] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(where);
  const rows =
    count === 0
      ? []
      : await tx
          .select(userColumns)
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(where)
          .orderBy(asc(user.email), asc(user.id))
          .limit(count)
          .offset(startIndex - 1);
  return {
    status: 200,
    body: {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: total?.n ?? 0,
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map(toScimUser),
    },
  };
}

function record_(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The role in a SCIM `roles` value (`[{value}]` or `["x"]`), or null when none is given. */
function roleOf(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return text(typeof first === 'string' ? first : record_(first).value)?.toLowerCase() ?? null;
}

function grantable(role: string): 'advocate' | 'junior' | 'clerk' | 'viewer' {
  if (!isRole(role) || role === 'owner') {
    throw new ScimError(400, `Role not grantable: ${role}`, 'invalidValue');
  }
  return role;
}

function flag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(true|false)$/i.test(value))
    return value.toLowerCase() === 'true';
  return null;
}

/** `POST /Users`: add (or reactivate) a member; an address that is already active is a 409. */
export async function createScimUser(
  tx: Queryable,
  identity: ScimIdentity,
  body: unknown,
): Promise<ScimResult> {
  const input = record_(body);
  const emails = Array.isArray(input.emails) ? input.emails : [];
  const email = (text(input.userName) ?? text(record_(emails[0]).value) ?? '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ScimError(400, 'userName must be an email address', 'invalidValue');
  }
  const name = record_(input.name);
  const displayName =
    text(input.displayName) ??
    text(name.formatted) ??
    text([text(name.givenName), text(name.familyName)].filter(Boolean).join(' '));
  const role = grantable(roleOf(input.roles) ?? DEFAULT_PROVISIONING_ROLE);
  const added = await addProvisionedMember(tx, {
    workspaceId: identity.workspaceId,
    email,
    name: displayName ?? undefined,
    role,
  });
  if (added.outcome === 'exists') throw new ScimError(409, 'User already exists', 'uniqueness');
  if (flag(input.active) === false) {
    await deactivateProvisionedMember(tx, {
      workspaceId: identity.workspaceId,
      userId: added.userId,
    });
  }
  await audit(tx, identity, 'member.provisioned', added.userId, added.outcome);
  return { status: 201, body: toScimUser(await findUser(tx, identity, added.userId)) };
}

/** `GET /Users/{id}`. */
export async function getScimUser(
  tx: Queryable,
  identity: ScimIdentity,
  userId: string,
): Promise<ScimResult> {
  return { status: 200, body: toScimUser(await findUser(tx, identity, userId)) };
}

interface Changes {
  active?: boolean;
  role?: string;
}

function collect(changes: Changes, path: string | null, value: unknown): void {
  const key = path?.toLowerCase();
  if (key === undefined) {
    const object = record_(value);
    if ('active' in object) collect(changes, 'active', object.active);
    if ('roles' in object) collect(changes, 'roles', object.roles);
    return;
  }
  if (key === 'active') {
    const active = flag(value);
    if (active === null) throw new ScimError(400, 'active must be a boolean', 'invalidValue');
    changes.active = active;
  } else if (key === 'roles' || key.startsWith('roles[')) {
    const role = roleOf(value);
    if (role !== null) changes.role = role;
  }
  // userName, displayName and name.* are owned by the user's account, not the workspace: ignored.
}

async function applyChanges(
  tx: Queryable,
  identity: ScimIdentity,
  userId: string,
  changes: Changes,
): Promise<ScimResult> {
  const current = await findUser(tx, identity, userId);
  if (changes.role !== undefined && changes.role !== current.role) {
    const role = grantable(changes.role);
    if (current.role === 'owner') {
      throw new ScimError(400, 'An owner role cannot be changed through SCIM', 'mutability');
    }
    await tx
      .update(member)
      .set({ role, roleGrantedAt: sql`now()` })
      .where(and(eq(member.organizationId, identity.workspaceId), eq(member.userId, userId)));
    await audit(tx, identity, 'member.provisioned', userId, 'role');
    current.role = role;
  }
  if (changes.active === false && current.status === 'active') {
    await deactivateProvisionedMember(tx, { workspaceId: identity.workspaceId, userId });
    await audit(tx, identity, 'member.deprovisioned', userId, 'suspended');
  } else if (changes.active === true && current.status !== 'active') {
    await addProvisionedMember(tx, {
      workspaceId: identity.workspaceId,
      email: current.email,
      role: grantable(current.role),
    });
    await audit(tx, identity, 'member.provisioned', userId, 'reactivated');
  }
  return { status: 200, body: toScimUser(await findUser(tx, identity, userId)) };
}

/** `PATCH /Users/{id}`: `active` and `roles` through `add` or `replace` operations. */
export async function patchScimUser(
  tx: Queryable,
  identity: ScimIdentity,
  userId: string,
  body: unknown,
): Promise<ScimResult> {
  const operations = record_(body).Operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ScimError(400, 'Operations must be a non-empty array', 'invalidSyntax');
  }
  const changes: Changes = {};
  for (const raw of operations) {
    const operation = record_(raw);
    const op = typeof operation.op === 'string' ? operation.op.toLowerCase() : '';
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw new ScimError(400, `Unsupported operation: ${op}`, 'invalidSyntax');
    }
    if (op === 'remove') continue;
    collect(changes, text(operation.path), operation.value);
  }
  return applyChanges(tx, identity, userId, changes);
}

/** `PUT /Users/{id}`: the workspace-owned attributes (`active`, `roles`) of the body replace the user's. */
export function replaceScimUser(
  tx: Queryable,
  identity: ScimIdentity,
  userId: string,
  body: unknown,
): Promise<ScimResult> {
  const changes: Changes = {};
  collect(changes, null, body);
  return applyChanges(tx, identity, userId, changes);
}

/** `DELETE /Users/{id}`: the member is marked removed. */
export async function deleteScimUser(
  tx: Queryable,
  identity: ScimIdentity,
  userId: string,
): Promise<ScimResult> {
  await findUser(tx, identity, userId);
  await deactivateProvisionedMember(tx, {
    workspaceId: identity.workspaceId,
    userId,
    remove: true,
  });
  await audit(tx, identity, 'member.deprovisioned', userId, 'removed');
  return { status: 204 };
}

/** `GET /ServiceProviderConfig`: what this endpoint supports. */
export function scimServiceProviderConfig(): ScimResult {
  return {
    status: 200,
    body: {
      schemas: [SCIM_CONFIG_SCHEMA],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_PAGE },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer token',
          description: 'A SCIM token issued by a workspace owner',
        },
      ],
    },
  };
}

export function scimError(status: number, detail: string, scimType?: string): ScimResult {
  return {
    status,
    body: {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    },
  };
}

function failure(error: unknown): ScimResult | null {
  if (error instanceof ScimError) return scimError(error.status, error.message, error.scimType);
  if (error instanceof WorkspaceError) {
    if (error.code === 'NOT_FOUND') return scimError(404, error.message);
    if (error.code === 'FORBIDDEN') return scimError(403, error.message);
    if (error.code === 'CONFLICT') return scimError(409, error.message, 'uniqueness');
    if (error.code === 'VALIDATION') return scimError(400, error.message, 'invalidValue');
  }
  if (error instanceof Error && error.name === 'EntitlementError') {
    return scimError(403, 'The plan has no seat left for this role');
  }
  return null;
}

/**
 * Run one SCIM request: `authorization` is the raw header. A missing, malformed, unknown, revoked or
 * expired token is a 401 and nothing runs. Otherwise `run` executes in the token's workspace scope
 * (the token's last use is stamped in the same transaction); a thrown `ScimError`, `WorkspaceError`
 * or seat-gate error becomes the SCIM error body and the transaction rolls back. Anything else
 * rethrows.
 */
export async function handleScim(
  db: Queryable,
  authorization: string | null,
  run: (tx: Transaction, identity: ScimIdentity) => Promise<ScimResult>,
  now: Date = new Date(),
): Promise<ScimResult> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  const identity = token ? await authenticateScimToken(db, token, now) : null;
  if (!identity) return scimError(401, 'Invalid or missing SCIM token');
  try {
    return await withWorkspace(db, { workspaceId: identity.workspaceId }, async (tx) => {
      await tx.update(scimToken).set({ lastUsedAt: now }).where(eq(scimToken.id, identity.tokenId));
      return run(tx, identity);
    });
  } catch (error) {
    const result = failure(error);
    if (result) return result;
    throw error;
  }
}
