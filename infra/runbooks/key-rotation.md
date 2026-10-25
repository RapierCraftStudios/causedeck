# Runbook: key rotation

Owner: Engineering lead
Last drilled: not yet drilled

## Purpose

Rotate every key class on schedule and in an emergency without downtime: the KEK, per-workspace DEKs, JWT and
session secrets, API keys, SSH and deploy keys and backup encryption keys.

## Triggers

Scheduled rotation (table below), a suspected or confirmed exposure (use the emergency path), a person with
custody leaving, or a provider notice. A suspected exposure also opens [cert-in-6h](cert-in-6h.md).

## Roles

| Role              | Does                                                     |
| ----------------- | -------------------------------------------------------- |
| Rotation operator | Runs the steps and records each verification             |
| Engineering lead  | Approves emergency rotation, holds a custody copy        |
| Second custodian  | Holds the second sealed copy of backup and evidence keys |

## Steps

Secrets inventory (values live in the secret manager and on tmpfs, never in the repo):

| Key                        | Where it lives                           | Scheduled | Notes                                                          |
| -------------------------- | ---------------------------------------- | --------- | -------------------------------------------------------------- |
| KEK (`KEK_BASE64`, kek id) | secret manager, app env                  | 12 months | Re-wraps DEKs, no data rewritten                               |
| Workspace DEKs             | `workspace_key` rows, wrapped by KEK     | with KEK  | A leaked DEK needs re-encryption: counsel and engineering lead |
| Session and JWT secrets    | app env (auth)                           | 6 months  | Rotating signs everyone out                                    |
| API secrets and API keys   | app env, workspace API keys              | 6 months  | Customers re-issue their own keys                              |
| SSH and deploy keys        | VPS `authorized_keys`, CI secrets        | 6 months  |                                                                |
| Backup encryption key      | tmpfs `/run/causedeck/walg.key`, custody | 12 months | See [restore](restore.md)                                      |
| Evidence archive key       | custody                                  | 12 months | Old key kept to read old archives                              |

Schedule rotations between 10:30 and 18:00 IST ([court-day-freeze](court-day-freeze.md)).

### 1. KEK rotation with DEK re-wrap (no downtime)

1. Generate the new KEK: `openssl rand -base64 32`; store it in the secret manager under the new id (`kek-2`).
2. Deploy so the provider holds the new KEK first and the old one still present. New DEKs use the new KEK;
   existing ones still unwrap with the old one (`docs/engineering/storage.md`, "KEK rotation").
3. Dry run, then rotate (keys come from the environment, loaded from the secret manager):
   ```sh
   export DATABASE_URL=<app role URL> KEK_NEW_BASE64=<new> KEK_OLD_BASE64=<old> KEK_NEW_ID=kek-2 KEK_OLD_ID=kek-1
   bash infra/scripts/runbooks/rotate-kek.sh --dry-run   # prints the pending count
   bash infra/scripts/runbooks/rotate-kek.sh             # exit 0 only when remaining is 0
   ```
4. **Verify**: `rotate-kek.sh --dry-run` prints `"pending":0`; open a document in the app; the CI test
   `packages/storage/src/__tests__/rotate-kek-script.test.ts` proves decrypt-after-rotation and old-KEK rejection.
5. Retire the old KEK from the provider and the secret store. **Verify**: with only the new KEK configured, the
   app health check (`/readyz`) passes and a document still opens.

Known gap (Stage A): `EnvKeyProvider.fromEnv` names `KEK_BASE64` `kek-1`, so a deployment can only run on the new
KEK alone once the provider is built with an explicit id (`new EnvKeyProvider([kek])`, as in the storage docs) or
Stage B KMS lands. Until then keep both KEKs configured and treat the rotation as an exercise on staging;
track the runtime change as engineering work, do not edit it ad hoc during an incident.

### 2. Session and JWT secrets

Generate (`openssl rand -base64 48`), update the secret manager, redeploy, accept that sessions end.
**Verify**: an old session cookie is rejected (`curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: <old>' <app>/api/auth/get-session`
shows no session) and a fresh sign-in works.

### 3. API secrets and API keys

Rotate platform API secrets as above; for a leaked customer key, revoke it from the workspace settings and
tell the customer ([dpdp-breach](dpdp-breach.md) if data was exposed). **Verify**: the old key returns 401.

### 4. SSH and deploy keys

Add the new public key, confirm login with it from a second terminal, then remove the old one; replace the CI
deploy secret. **Verify**: `ssh -o IdentitiesOnly=yes -i <old key> <host>` is refused and a deploy run succeeds.

### 5. Backup encryption key

As in [restore](restore.md): generate, deploy, take a new base backup, keep the old key until the last backup
made with it has aged out (8 weeks), then destroy it. **Verify**: `wal-g backup-list` works and a restore drill
on the new backup passes.

### 6. Emergency compromise path

1. Declare P0, note detection time, open [cert-in-6h](cert-in-6h.md).
2. Revoke first, rotate second: disable the exposed credential, then rotate the affected class from the table
   (all classes if the host is suspected), most sensitive first (KEK, DB roles, session secrets, SSH keys).
3. Rotate even if it costs sign-outs; skip the schedule and the court-day window only with the engineering lead's
   approval recorded in the ticket.
4. Export evidence before any host is rebuilt.

## Communications

Tell customers about forced sign-outs and re-issued API keys through the support channel. No automated outbound
messages go to third parties; notices are approved by a human and sent by a human after approval.

## Evidence

Ticket entry per rotation: key class, time, operator, verification output. Never paste a key into a ticket.

## Verification

Each step above has a verification command; the rotation is complete when all pass and the old key is rejected.

## After action

Update `Last drilled`; record the drill under [drills](drills/README.md); review the schedule yearly.
