# Document storage for Stage B (#106): the S3 replacement for MinIO. The app selects it with env
# alone (STORAGE_PROVIDER=s3, S3_BUCKET, S3_REGION; see docs/engineering/storage.md). Object keys keep
# the `ws/<workspace_id>/...` layout of packages/storage/src/keys.ts.

data "aws_region" "primary" {}

data "aws_region" "replica" {
  provider = aws.replica
}

data "aws_iam_policy_document" "kms" {
  #checkov:skip=CKV_AWS_356:KMS key policy: Resource * means this key (resource-based policy); access is scoped by principals and conditions
  #checkov:skip=CKV_AWS_109:KMS key policy: Resource * means this key (resource-based policy); access is scoped by principals and conditions
  #checkov:skip=CKV_AWS_111:KMS key policy: Resource * means this key (resource-based policy); access is scoped by principals and conditions
  statement {
    sid       = "Administer"
    actions   = ["kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion", "kms:TagResource", "kms:UntagResource"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = var.kms_admin_role_arns
    }
  }

  statement {
    sid       = "Use"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = concat(var.app_role_arns, [aws_iam_role.replication.arn])
    }
  }
}

resource "aws_kms_key" "primary" {
  description             = "${var.name} documents (${var.region})"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json
  tags                    = var.tags
}

resource "aws_kms_key" "replica" {
  provider = aws.replica

  description             = "${var.name} documents replica (${var.replica_region})"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json
  tags                    = var.tags
}

# ---- Buckets ----

resource "aws_s3_bucket" "documents" {
  #checkov:skip=CKV2_AWS_62:No event consumers: documents are read through the app, not S3 events
  #checkov:skip=CKV_AWS_18:Server access logs need a dedicated log bucket; object access is audited by the app
  bucket = "${var.name}-documents"
  tags   = var.tags

  lifecycle {
    precondition {
      condition     = data.aws_region.primary.region == var.region
      error_message = "The default aws provider must be configured for var.region (an India region)."
    }
  }
}

resource "aws_s3_bucket" "replica" {
  #checkov:skip=CKV2_AWS_62:No event consumers: documents are read through the app, not S3 events
  #checkov:skip=CKV_AWS_18:Server access logs need a dedicated log bucket; object access is audited by the app
  #checkov:skip=CKV2_AWS_61:Replica of legal documents: retention is governed by versioning and the source bucket; no expiry
  provider = aws.replica

  bucket = "${var.name}-documents-replica"
  tags   = var.tags

  lifecycle {
    precondition {
      condition     = data.aws_region.replica.region == var.replica_region
      error_message = "The aws.replica provider must be configured for var.replica_region (an India region)."
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "replica" {
  provider = aws.replica

  bucket                  = aws_s3_bucket.replica.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "replica" {
  provider = aws.replica

  bucket = aws_s3_bucket.replica.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.primary.arn
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "replica" {
  provider = aws.replica

  bucket = aws_s3_bucket.replica.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.replica.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "expire-noncurrent-and-abort-multipart"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ---- Bucket policy: TLS only, SSE-KMS only ----

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyUnencryptedPut"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.documents.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket     = aws_s3_bucket.documents.id
  policy     = data.aws_iam_policy_document.bucket.json
  depends_on = [aws_s3_bucket_public_access_block.documents]
}

# ---- Per-workspace prefix: a role tagged workspace_id reaches only ws/<that id>/ ----

data "aws_iam_policy_document" "workspace_prefix" {
  statement {
    sid       = "ObjectsUnderOwnWorkspacePrefix"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.documents.arn}/ws/$${aws:PrincipalTag/workspace_id}/*"]
  }

  statement {
    sid       = "ListOwnWorkspacePrefix"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.documents.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["ws/$${aws:PrincipalTag/workspace_id}/*"]
    }
  }

  statement {
    sid       = "UseDocumentsKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.primary.arn]
  }
}

resource "aws_iam_policy" "workspace_prefix" {
  name_prefix = "${var.name}-workspace-prefix-"
  description = "Scopes a principal tagged workspace_id to its own ws/<workspace_id>/ prefix"
  policy      = data.aws_iam_policy_document.workspace_prefix.json
  tags        = var.tags
}

# ---- Cross-region replication to the second India region ----

data "aws_iam_policy_document" "replication_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "replication" {
  name_prefix        = "${var.name}-s3-replication-"
  assume_role_policy = data.aws_iam_policy_document.replication_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "replication" {
  statement {
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = [aws_s3_bucket.documents.arn]
  }

  statement {
    actions   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  statement {
    actions   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
    resources = ["${aws_s3_bucket.replica.arn}/*"]
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.primary.arn]
  }

  statement {
    actions   = ["kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.replica.arn]
  }
}

resource "aws_iam_role_policy" "replication" {
  name   = "replicate-documents"
  role   = aws_iam_role.replication.id
  policy = data.aws_iam_policy_document.replication.json
}

resource "aws_s3_bucket_replication_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  role   = aws_iam_role.replication.arn

  rule {
    id     = "documents-to-${var.replica_region}"
    status = "Enabled"

    filter {}

    delete_marker_replication {
      status = "Disabled"
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }

    destination {
      bucket        = aws_s3_bucket.replica.arn
      storage_class = "STANDARD"

      encryption_configuration {
        replica_kms_key_id = aws_kms_key.replica.arn
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.documents, aws_s3_bucket_versioning.replica]
}
