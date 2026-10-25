// Flag evaluation (#22, docs/engineering/flags.md). Precedence, first match wins:
//   1. kill switch `KILL_<KEY>` true in the env → off, without reading the database;
//   2. the workspace's override row (`workspace_feature_flag`, under RLS);
//   3. the global row (`feature_flag`);
//   4. the registry default (`false`).
// A legal-gated (⚖) flag is on only when every row that turns it on carries `legal_ack_by`, and a
// workspace row can turn one on only while the global row is on with its own legal ack: a workspace
// row alone never enables a legal flag. Any row may turn a flag off.
import { killSwitch, serverEnv } from '@causedeck/config/env';
import { db as appDb, withWorkspace, type Queryable } from '@causedeck/db';
import { featureFlag, workspaceFeatureFlag } from '@causedeck/db/schema';
import { eq } from 'drizzle-orm';

import { FlagCache, registerFlagCache } from './cache.ts';
import {
  FLAG_KEYS,
  getFlag,
  type FlagDefinition,
  type FlagKey,
  type FlagSnapshot,
} from './keys.ts';

export interface FlagContext {
  workspaceId: string;
  userId?: string | undefined;
}

/** The parts of a flag row evaluation needs. Notes and actors never leave the server. */
export interface FlagRow {
  enabled: boolean;
  legalAckBy: string | null;
}

/** One workspace's flag rows: the global rows and its overrides, by key. */
export interface FlagRows {
  global: Readonly<Record<string, FlagRow>>;
  workspace: Readonly<Record<string, FlagRow>>;
}

export interface FlagLayers {
  /** The kill switch for the flag is set. */
  killed: boolean;
  global?: FlagRow | undefined;
  workspace?: FlagRow | undefined;
}

const legallyOn = (row: FlagRow | undefined) => row?.enabled === true && row.legalAckBy !== null;

/** Pure precedence rule for one flag (see the file header). */
export function resolveFlag(
  def: Pick<FlagDefinition, 'default' | 'legalGated'>,
  layers: FlagLayers,
): boolean {
  if (layers.killed) return false;
  const { global, workspace } = layers;
  if (def.legalGated) {
    if (workspace !== undefined) return legallyOn(workspace) && legallyOn(global);
    return legallyOn(global);
  }
  if (workspace !== undefined) return workspace.enabled;
  if (global !== undefined) return global.enabled;
  return def.default;
}

export interface EvaluateDeps {
  /** Defaults to the app-role client. A transaction works too (tests). */
  db?: Queryable;
  /** Parsed `KILL_*` switches; defaults to `serverEnv().killSwitches`. */
  killSwitches?: Readonly<Record<string, boolean>>;
  /** Defaults to the process-wide cache; `null` disables caching. */
  cache?: FlagCache<FlagRows> | null;
}

/** Process-wide cache of each workspace's rows (15 s TTL, emptied by `flag_changed`). */
export const flagRowsCache: FlagCache<FlagRows> = registerFlagCache(new FlagCache<FlagRows>());

function isKilled(def: FlagDefinition, deps: EvaluateDeps): boolean {
  if (deps.killSwitches !== undefined) return deps.killSwitches[def.killSwitchEnv] === true;
  return killSwitch(def.killSwitchEnv, serverEnv());
}

/** Read the global rows and the workspace's overrides (RLS keeps other workspaces out). */
export async function loadFlagRows(db: Queryable, ctx: FlagContext): Promise<FlagRows> {
  const scope =
    ctx.userId === undefined
      ? { workspaceId: ctx.workspaceId }
      : { workspaceId: ctx.workspaceId, userId: ctx.userId };
  return withWorkspace(db, scope, async (tx) => {
    const columns = {
      key: featureFlag.key,
      enabled: featureFlag.enabled,
      legalAckBy: featureFlag.legalAckBy,
    };
    const [globals, overrides] = await Promise.all([
      tx.select(columns).from(featureFlag),
      tx
        .select({
          key: workspaceFeatureFlag.key,
          enabled: workspaceFeatureFlag.enabled,
          legalAckBy: workspaceFeatureFlag.legalAckBy,
        })
        .from(workspaceFeatureFlag)
        .where(eq(workspaceFeatureFlag.workspaceId, ctx.workspaceId)),
    ]);
    const byKey = (rows: { key: string; enabled: boolean; legalAckBy: string | null }[]) =>
      Object.fromEntries(
        rows.map(({ key, enabled, legalAckBy }) => [key, { enabled, legalAckBy }]),
      );
    return { global: byKey(globals), workspace: byKey(overrides) };
  });
}

async function rowsFor(ctx: FlagContext, deps: EvaluateDeps): Promise<FlagRows> {
  const cache = deps.cache === undefined ? flagRowsCache : deps.cache;
  const scope = ctx.workspaceId.toLowerCase();
  const cached = cache?.get(scope);
  if (cached !== undefined) return cached;
  const rows = await loadFlagRows(deps.db ?? appDb, ctx);
  cache?.set(scope, rows);
  return rows;
}

/**
 * Whether `key` is on for the workspace. A kill switch answers without touching the database; an
 * unknown key throws `UnknownFlagError`.
 */
export async function isEnabled(
  key: FlagKey,
  ctx: FlagContext,
  deps: EvaluateDeps = {},
): Promise<boolean> {
  const def = getFlag(key);
  if (isKilled(def, deps)) return false;
  const rows = await rowsFor(ctx, deps);
  return resolveFlag(def, {
    killed: false,
    global: rows.global[key],
    workspace: rows.workspace[key],
  });
}

/** Every flag's value for the workspace: the snapshot passed to clients (booleans only). */
export async function evaluateAll(
  ctx: FlagContext,
  deps: EvaluateDeps = {},
): Promise<FlagSnapshot> {
  const rows = await rowsFor(ctx, deps);
  return Object.fromEntries(
    FLAG_KEYS.map((key) => {
      const def = getFlag(key);
      const killed = isKilled(def, deps);
      return [
        key,
        resolveFlag(def, { killed, global: rows.global[key], workspace: rows.workspace[key] }),
      ];
    }),
  ) as FlagSnapshot;
}
