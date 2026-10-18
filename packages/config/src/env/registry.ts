// Key metadata shared by the env schema, the `.env.example` generator and the docs coverage test.
// Kept free of server-only code so the client env module can import it.

export type EnvDomain =
  | 'shared'
  | 'server'
  | 'client'
  | 'email'
  | 'ai'
  | 'storage'
  | 'billing'
  | 'auth'
  | 'observability'
  | 'kill-switches';

export interface KeyMeta {
  domain: EnvDomain;
  /** Human-readable type, e.g. `url`, `enum(console|ses|smtp)`. */
  type: string;
  /** Becomes the zod `.describe()` text and the `.env.example` comment. */
  description: string;
  /** Default applied in every environment. */
  default?: string;
  /** Local default (Docker services from #5) applied only when `NODE_ENV !== 'production'`. */
  devDefault?: string;
  requiredWhen: string;
  /** Issue that owns (consumes) the key. */
  ownerIssue: number;
  /** `chore(human)` issue that supplies the real credential, when one is needed. */
  credentialIssue?: number;
  /** Wrapped in `Secret` and never written to `.env.example` with a real value. */
  secret?: boolean;
}

export interface KeySpec extends KeyMeta {
  name: string;
}

export type KeyMetaRecord = Record<string, KeyMeta>;

export function specsOf(metas: KeyMetaRecord): KeySpec[] {
  return Object.entries(metas).map(([name, meta]) => ({ name, ...meta }));
}

/** Fill `default` and (outside production) `devDefault` values for keys that are unset. */
export function applyDefaults(
  metas: KeyMetaRecord,
  input: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const isProd = input.NODE_ENV === 'production';
  const out = { ...input };
  for (const [name, meta] of Object.entries(metas)) {
    if (out[name] !== undefined) continue;
    const value = meta.default ?? (isProd ? undefined : meta.devDefault);
    if (value !== undefined) out[name] = value;
  }
  return out;
}
