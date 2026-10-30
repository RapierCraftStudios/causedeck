# aws-s3-documents

Stage B document bucket (#106), the S3 replacement for MinIO. The app switches with env only:
`STORAGE_PROVIDER=s3`, `S3_BUCKET=<bucket_name>`, `S3_REGION=ap-south-1`, no `S3_ENDPOINT`.

- Public access is blocked on both buckets; the bucket policy denies plain HTTP and unencrypted puts.
- Versioning is on, with SSE-KMS (customer-managed key, rotation on, administrators and users
  separated).
- `workspace_prefix_policy_arn` scopes a principal tagged `workspace_id` to `ws/<workspace_id>/`
  (object access and `s3:prefix` list condition), matching `packages/storage/src/keys.ts`.
- Cross-region replication goes to the other India region (`ap-south-2`); both regions are validated.
