# Storage encryption

Every tenant object and encrypted field is encrypted inside our process before it reaches S3 or
Postgres, with a key that belongs to one workspace (spike §1, §6; architecture §6.3, §6.4; #21,
#216). Destroying that key makes all of the workspace's data unreadable (crypto-erase), and the
master key can rotate without rewriting any object. S3 server-side encryption (SSE-S3 or SSE-KMS at
Stage B) is defence in depth on top of this. Cloudflare R2 is never used for tenant documents.
Exception for now: uploaded blobs go browser-to-S3 through presigned URLs and are stored as uploaded
(see [Uploads and downloads](#uploads-and-downloads) below); encrypting their bodies is a follow-up.

| What | Where |
|---|---|
| AES-256-GCM primitives | `packages/storage/src/crypto/aead.ts` |
| KEKs and the `KeyProvider` seam | `packages/storage/src/crypto/kek.ts` |
| DEK generation and wrapping | `packages/storage/src/crypto/dek.ts` |
| Streaming format v1 | `packages/storage/src/crypto/envelope.ts` |
| Field encryption | `packages/storage/src/field-crypto.ts` |
| Workspace keys, crypto-erase, rotation | `packages/storage/src/workspace-crypto.ts` |
| `workspace_key` table | `packages/db/src/schema/storage.ts`, `packages/db/migrations/0016_storage.sql` |
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
AES-256-GCM with the workspace DEK and AAD = the workspace id (lower case). It is for small values in
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

## Uploads and downloads

Workspace-scoped upload and download services (#217, #21 part 3) on top of the `ObjectStore`.
Callers pass a `StorageCtx` (`db`, `store`, the checked `workspaceId` and `userId`, an `authorize`
seam that the web route wires to `assertCan`). Every query runs in `withWorkspace`, so a blob of
another workspace is simply not found. The services take blob ids, never object keys; keys are built
server-side as `ws/<workspaceId>/<kind>/<yyyy>/<blobId>`.

| What | Where |
|---|---|
| Allow-list, deny-list, sniffing | `packages/storage/src/mime.ts` |
| Intent and finalize | `packages/storage/src/upload.ts` |
| Download URLs | `packages/storage/src/download.ts` |
| Audit seam (`StorageAuditSink`, writer in #26) | `packages/storage/src/audit.ts` |
| `blob` table | `packages/db/src/schema/storage.ts`, `packages/db/migrations/0020_blob.sql` |
| Route Handler | `apps/web/app/api/uploads/route.ts` |
| Tests | `packages/storage/src/__tests__/{upload,download,cross-tenant-presign}.test.ts` |

1. **Intent** (`createUploadIntent`, `document.write`). The kind, the file extension and the declared
   MIME must match one allow-list entry, and the size must be within the kind's cap (`limits.ts`).
   It inserts a `blob` row with `scan_status` null (an open intent) and returns a presigned PUT
   (5 minutes) bound to the key, `Content-Type` and `Content-Length`.
2. **Finalize** (`finalizeUpload`, `document.write`). It reads the stored bytes back, checks the
   size, sniffs the type from the magic bytes (`file-type`; text is checked for UTF-8, NUL bytes and
   leading markup), and requires the sniffed type to be one the intent's entry accepts. It then sets
   the sniffed `mime`, `sha256`, `finalized_at` and `scan_status = 'pending'`. A rejected upload is
   deleted (object and row). Finalize is idempotent; an object not yet uploaded leaves the intent.
3. **Download** (`createDownloadUrl`, `document.read`). Only a finalized blob that is not `infected`
   (open intents and infected files read as `NOT_FOUND`). The presigned GET lives 60 seconds and
   carries `response-content-disposition: attachment; filename=...; filename*=UTF-8''...` and
   `response-content-type` set to the sniffed type. Each URL issued is audited
   (`document.download_url_issued`).

**Allow-list.** PDF, DOCX, `.ics`, `.txt` (kind `document`); PNG, JPEG, HEIC (`image`); m4a, mp3,
wav, ogg/opus, webm (`audio`); `.zip` (`zip`). A `.pdf` holding HTML, a `.zip` holding an executable,
a `.docx` that is a plain zip and the reverse are all rejected at finalize.

**Deny-list.** Executables, scripts and markup are never allowed, at intent (extension, including
any inner part of a double extension, and declared MIME) and at finalize (sniffed MIME): PE, ELF,
Mach-O, MSI, JAR/APK, shell and other scripts, JavaScript, HTML/XHTML, SVG, XML, Flash and wasm.

**`scan_status`.** null (open intent) → `pending` at finalize → `clean`, `infected` or `skipped`,
set by the ClamAV worker (later; optional at Stage A, required at Stage B). The check constraint
`blob_scan_status_chk` allows only these values.

**PDFs.** No code path in `@causedeck/storage` parses, renders or executes PDF content: finalize
only reads magic bytes and hashes. PDF previews are rendered to images in a worker (#45), and
uploaded PDF JavaScript never runs. A test asserts the package has no PDF, renderer, `vm` or
`child_process` dependency.

**`nosniff`.** Downloads must carry `X-Content-Type-Options: nosniff`. An S3 presign cannot set
that header (only `response-content-*`, cache-control and expires overrides exist), so the storage
edge in front of MinIO/S3 adds it (Caddy, #98; CloudFront response headers policy at Stage B). Until
then the forced `attachment` disposition and sniffed allow-listed type are what keep a browser from
rendering a download inline. The memory provider serves `nosniff` itself.

**Route.** `POST /api/uploads` with `{action: 'intent' | 'finalize' | 'download', workspaceId,
...}`: 403 cross-origin, 401 signed out, 404 not a member (indistinguishable from another
workspace's blob), 429 over `UPLOAD_RATE_LIMIT` (120 per user per 10 minutes), 400 invalid input or
file, 413 over the size cap, 403 not permitted by role.

**Follow-up: encrypted blob bodies.** Blob bodies are stored as uploaded today, because a browser
cannot decrypt an envelope-encrypted object fetched through a presigned GET. Encrypting them needs
a server-streamed decrypting download; `blob.enc_header` is already there (nullable) for it.


## Capture uploads (#43)

The capture inbox ([ADR 0021](../adr/0021-capture-inbox-and-upload-pipeline.md)) rides this pipeline:
`createCapture` calls `createUploadIntent` and records `blob.key` as the capture's
`raw_storage_key`; `completeUpload` calls `finalizeUpload` (sniff, sha256), then de-duplicates,
scans and queues. Two storage options exist for it: an upload URL may live up to 10 minutes
(`uploadTtlSeconds`, capped at `MAX_UPLOAD_URL_TTL_SECONDS` = 600; `/api/uploads` keeps 5 minutes),
and the `quarantine` kind (server-written, 200 MB cap) holds raw objects a virus scan flagged.

**Routes.** `POST /api/captures/presign` and `POST /api/captures/:id/complete` (same gates as
`/api/uploads`; 415 type not allowed, 413 over the capture cap, 403 channel disabled or sensitive
matter excluded) and `POST /api/captures`, a multipart fallback for share-target posts up to 10 MB.

**Environment** (all optional, read when a capture is created or a job runs):

| Variable                                  | Effect                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `CAPTURE_SCAN_REQUIRED`                   | `true` makes a skipped scan a failure (Stage B); default `false` (Stage A)       |
| `CAPTURE_CLAMAV_HOST`, `CAPTURE_CLAMAV_PORT` | clamd address (port default 3310); without a host the no-op scanner runs      |
| `CAPTURE_CLAMAV_TIMEOUT_MS`, `CAPTURE_CLAMAV_MAX_BYTES` | clamd timeout (30000) and the most bytes sent (25 MB)              |
| `CAPTURE_MAX_BYTES_<TYPE>`                | size cap override per type: PDF, DOCX, ICS, TXT, PNG, JPEG, WEBP, HEIC, M4A, MP3, WAV, OGG, WEBM, ZIP |
