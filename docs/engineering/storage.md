# Storage encryption

Every tenant object and encrypted field is encrypted inside our process before it reaches S3 or
Postgres, with a key that belongs to one workspace (spike §1, §6; architecture §6.3, §6.4; #21,
#216). Destroying that key makes all of the workspace's data unreadable (crypto-erase), and the
master key can rotate without rewriting any object. S3 server-side encryption (SSE-S3 or SSE-KMS at
Stage B) is defence in depth on top of this. Cloudflare R2 is never used for tenant documents.

| What | Where |
|---|---|
| AES-256-GCM primitives | `packages/storage/src/crypto/aead.ts` |
| KEKs and the `KeyProvider` seam | `packages/storage/src/crypto/kek.ts` |
| DEK generation and wrapping | `packages/storage/src/crypto/dek.ts` |
| Streaming format v1 | `packages/storage/src/crypto/envelope.ts` |
| Field encryption | `packages/storage/src/field-crypto.ts` |
| Workspace keys, crypto-erase, rotation | `packages/storage/src/workspace-crypto.ts` |
| `workspace_key` table | `packages/db/src/schema/storage.ts`, `packages/db/migrations/0009_storage.sql` |
| Tests | `packages/storage/src/__tests__/{envelope,crypto-erase,rotation}.test.ts` |

## Key layout

```
KEK (KEK_BASE64 = "kek-1"; Stage B: AWS KMS)
 └─ wraps, per workspace ─ DEK (32 random bytes)        workspace_key.wrapped_dek
                            ├─ encrypts objects          format v1 below
                            └─ encrypts fields           "f1." values
```

- **KEK** (key-encryption key): 32 bytes. `EnvKeyProvider.fromEnv(env)` reads `KEK_BASE64` (a
  `Secret`, see [env.md](env.md)) as id `kek-1`. The provider holds a rotation list: the first KEK is
  current and wraps new DEKs; the rest are older KEKs kept until rotation completes.
- **DEK** (data-encryption key): one per workspace, created on first use by `ensureWorkspaceKey`.
  It is stored only wrapped: `wrapped_dek = nonce(12) | AES-256-GCM(KEK, DEK) | tag(16)` (60 bytes),
  with AAD = the workspace id (lower case), so a wrapped DEK copied to another workspace's row does
  not unwrap. `kek_id` names the KEK it is wrapped under.
- `workspace_key(workspace_id pk → organization, wrapped_dek bytea, kek_id, created_at,
  destroyed_at)` is a tenant table under FORCE row-level security (`ws_isolation`), registered in
  the cross-tenant suite. All reads and writes run inside `withWorkspace`.
- DEKs and KEKs are held in `Secret<Buffer>` and revealed only at the cipher call. Every
  `StorageCryptoError` has a fixed message and no `cause`, so no key, wrapped key or OpenSSL detail
  ends up in logs or error reports.

## Encryption format v1 (objects)

```
header   "CDE1"            4 bytes, magic
         0x01              1 byte, version
         L                 1 byte, kek id length (1..64)
         kek id            L bytes, UTF-8 (informational: the KEK when the object was written)
         workspace id      16 bytes (the wrapped-DEK reference: workspace_key is keyed by workspace)
         base nonce        12 random bytes
         chunk size        u32 big-endian (65536)
chunk i  ciphertext | tag  AES-256-GCM(DEK, nonce_i, AAD_i), tag 16 bytes
         nonce_i = base nonce with its last 4 bytes XOR i (u32 big-endian)
         AAD_i   = SHA-256(header) | u32 BE i | final flag (1 on the last chunk, else 0)
```

- Every chunk but the last holds exactly `chunk size` bytes of plaintext. The last holds 0 to
  `chunk size` bytes and the final flag; an empty object is a single empty final chunk (16 bytes).
  A reader treats the bytes left at end of stream as the final chunk.
- The header hash is in every chunk's AAD, so changing any header byte fails authentication.
  Indexes and the final flag in the AAD make reordering, splicing, truncating or appending chunks
  fail too. A malformed header (magic, version, kek id length, chunk size outside 16 B to 4 MiB) is
  `BAD_FORMAT`; anything else is `AUTH_FAILED`. Plaintext is released only after its chunk verifies.
- Encryption and decryption process one chunk at a time, so memory stays at a few chunks whatever the
  object size (the suite round-trips 120 MB in under 64 MB).
- Readers get the DEK from `workspace_key` (`decryptForWorkspace`), never from the kek id in the
  header, so rotation does not touch objects. The header should be stored with the object (the
  `blob.enc_header` column, #217).

## Field format v1

`encryptField(dek, workspaceId, text)` returns `f1.` + base64url(nonce(12) | ciphertext | tag(16)),
AES-256-GCM with the workspace DEK and AAD = `field:<workspace id>`. It is for small values in
Postgres, such as `packages/core` memory values. Crypto-erase covers fields too.

## Crypto-erase

`destroyWorkspaceKey(db, workspaceId)` (called by workspace deletion, #31) overwrites `wrapped_dek`
with zero bytes of the same length and sets `destroyed_at`, in one statement inside the workspace
scope. The check `workspace_key_destroyed_zeroed_chk` rejects a destroyed row that still holds key
bytes.

- From then on `getWorkspaceDek`, `decryptForWorkspace`, `encryptForWorkspace` and
  `ensureWorkspaceKey` throw `KEY_DESTROYED`. The row stays as a tombstone so a new key is never
  quietly created. Erasing a workspace that never had a key writes a tombstone.
- The DEK existed only wrapped in this row, so the ciphertext in S3, in backups and in encrypted
  fields cannot be decrypted, even with the KEK. Ciphertext can then be deleted at leisure. Database
  backups still hold the old wrapped DEK until they expire, so the erase completes when the last
  backup taken before it ages out (PRD NFR: within 30 days). Keep backup retention at or below that.
- It is idempotent and cannot be undone.

## KEK rotation

1. Generate the new KEK and deploy with it first in the provider's list and the old KEK still
   present (for `EnvKeyProvider`: `new EnvKeyProvider([newKek, oldKek])`). New DEKs are now wrapped
   with the new KEK, and existing ones still unwrap with the old one.
2. Run `rewrapAll(db, provider, newKekId)`. It lists workspaces whose live key is under another KEK
   through the SECURITY DEFINER function `app_workspace_keys_for_rewrap(text)` (ids only, see
   [tenancy.md](tenancy.md)). Then, one workspace per transaction with the row locked, it unwraps the
   DEK with the old KEK and stores it re-wrapped under the new KEK. DEKs, objects and fields do not
   change. Reads work throughout because each row names its own KEK. The function is resumable and
   idempotent, and it skips destroyed keys.
3. When it returns `remaining: 0` (or `pendingRewrap(db, newKekId)` is empty), remove the old KEK
   from the provider and from the secret store. It is retired.

A leaked KEK alone does not expose data (it also needs the `workspace_key` rows), but it should be
rotated as above. A leaked DEK means the workspace's objects must be re-encrypted under a new DEK,
which is a separate procedure, not yet automated.

## Stage B: KMS

`KmsKeyProvider` is the seam for AWS KMS in ap-south-1 (credentials: #109). It is a stub today: every
method throws `NOT_IMPLEMENTED`. At Stage B it implements `KeyProvider` with KMS `Encrypt`/`Decrypt`
(encryption context = workspace id) and a kek id such as `kms-<key id>`. To migrate, deploy a
provider that holds both the KMS key (current) and `kek-1`, then run `rewrapAll` to the KMS kek id.
After that, `KEK_BASE64` can be retired. The object format stays the same.
