# 0006. S3-compatible storage from MinIO to S3, with envelope encryption

## Status

Accepted

## Date

2026-10-18

## Context

Lawyers upload privileged documents (orders, cause lists, briefs, audio), and these must stay in India. A deleted workspace must be unrecoverable (D-033). Stage A is a single VPS, and Stage B moves state to AWS ap-south-1. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Object storage row), [§3.1](../engineering/13-technical-architecture-spike.md#31-bootstrap-stage-a-launch-to-about-1000-paid-seats) and [§6](../engineering/13-technical-architecture-spike.md#6-security-and-privacy-architecture) (Encryption, Uploads).

## Decision drivers

- India residency for every tenant document.
- The same code path from bootstrap to scale.
- Crypto-erase on workspace deletion, including copies in backups.
- Cheap at bootstrap.

## Considered options

| Option                                               | Verdict  | Reason                                                                                                  |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| S3 abstraction: MinIO on the VPS, then S3 ap-south-1 | Chosen   | One S3 API at every stage; self-hosted at bootstrap; India-region at scale                              |
| Cloudflare R2                                        | Rejected | Jurisdiction: R2 does not guarantee India-only storage, so it is not used for tenant documents          |
| AWS S3 from day one                                  | Rejected | It is the Stage B target, but at Stage A it adds cost and a second provider before the triggers are met |
| Blobs in Postgres                                    | Rejected | Bloats the database and its backups; no presigned uploads                                               |

## Decision

- `packages/storage` exposes an S3-compatible abstraction. Stage A uses **MinIO** on the VPS (with a nightly replica to a second India location). Stage B uses **AWS S3 ap-south-1**.
- Objects live under per-workspace key prefixes. Access is through short-lived presigned URLs.
- **Envelope encryption** for documents and memory values:
  - each workspace has its own data encryption key (**DEK**);
  - the DEK is wrapped by a key encryption key (**KEK**) held **in env and a secret manager at bootstrap, then in KMS at Stage B**;
  - deleting a workspace destroys its DEK (**crypto-erase**).
- Cloudflare R2 is **not** used for tenant documents.
- Uploads are MIME-sniffed against an allow-list and size-capped, then scanned by ClamAV in a worker (optional at Stage A, required at Stage B). PDFs are rendered to images for preview, and uploaded PDF JavaScript never runs.

Stage B storage note (D-037 amendment 2026-10-27): the default Stage B path keeps **MinIO on the Mumbai host** (OVH Public Cloud has no Mumbai object storage), with off-host backups to AWS S3 ap-south-2 (Hyderabad). Moving documents to AWS S3 ap-south-1 is optional, not the default; see [ADR 0053](0053-stage-b-c-scale-path.md). D-009 residency is unchanged.

Nuance made explicit: D-033 speaks of "India-region KMS". The spike (§6) places the KEK in env and a secret manager at bootstrap, with KMS from Stage B. This ADR follows the spike, which wins until it is amended.

## Consequences

- Positive: one code path across stages. Deletion is provable without scrubbing backups.
- Negative: losing a KEK loses every document, so key backup and rotation runbooks are mandatory.
- Negative: encryption adds CPU and latency to uploads and previews.

## Revisit when

- Spike §3.2 Stage B triggers: p95 latency > 400 ms, DB CPU > 60%, or > 1k seats. The KEK moves to KMS if AWS is adopted; MinIO moves to S3 ap-south-1 only if the optional AWS path is chosen.
- An India-only guarantee becomes available from another provider at materially lower cost.

## Links

- [Spike §6](../engineering/13-technical-architecture-spike.md#6-security-and-privacy-architecture)
- [DECISIONS.md](../../DECISIONS.md) D-033
