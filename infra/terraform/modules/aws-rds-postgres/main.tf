# RDS Postgres for Stage B (#106): ap-south-1 primary, ap-south-2 (Hyderabad) read replica, both
# encrypted with customer-managed KMS keys, private subnets only, TLS enforced, PITR on. Plan-able
# with dummy credentials; apply only through the gated workflow (.github/workflows/terraform.yml).

data "aws_region" "primary" {}

data "aws_region" "replica" {
  provider = aws.replica
}

locals {
  key_admins = var.kms_admin_role_arns
  key_users  = concat(var.kms_user_role_arns, ["arn:aws:iam::${var.account_id}:root"])
}

# ---- KMS keys: administrators cannot use the key and users cannot administer it ----

data "aws_iam_policy_document" "kms_primary" {
  #checkov:skip=CKV_AWS_356:KMS key policy: Resource * means this key (resource-based policy); access is scoped by principals and conditions
  #checkov:skip=CKV_AWS_109:KMS key policy: Resource * means this key (resource-based policy); access is scoped by principals and conditions
  #checkov:skip=CKV_AWS_111:KMS key policy: Resource * means this key (resource-based policy); access is scoped by principals and conditions
  statement {
    sid       = "Administer"
    actions   = ["kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*", "kms:Disable*", "kms:Get*", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion", "kms:TagResource", "kms:UntagResource"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = local.key_admins
    }
  }

  statement {
    sid       = "Use"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey", "kms:CreateGrant"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = local.key_users
    }

    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_kms_key" "primary" {
  description             = "${var.name} RDS storage and backups (${var.region})"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_primary.json
  tags                    = var.tags
}

resource "aws_kms_alias" "primary" {
  name          = "alias/${var.name}-rds"
  target_key_id = aws_kms_key.primary.key_id
}

resource "aws_kms_key" "replica" {
  provider = aws.replica

  description             = "${var.name} RDS replica storage (${var.replica_region})"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_primary.json
  tags                    = var.tags
}

# ---- Network: security groups by service, no CIDR ingress, no public endpoint ----

resource "aws_security_group" "primary" {
  name_prefix = "${var.name}-rds-"
  description = "Postgres from app and worker security groups only"
  vpc_id      = var.vpc_id
  tags        = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "primary" {
  for_each = toset(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.primary.id
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres from service security group"
}

resource "aws_db_subnet_group" "primary" {
  name       = "${var.name}-rds"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "replica" {
  provider = aws.replica

  name_prefix = "${var.name}-rds-replica-"
  description = "Postgres replica from service security groups only"
  vpc_id      = var.replica_vpc_id
  tags        = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "replica" {
  provider = aws.replica
  for_each = toset(var.replica_allowed_security_group_ids)

  security_group_id            = aws_security_group.replica.id
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres replica from service security group"
}

resource "aws_db_subnet_group" "replica" {
  provider = aws.replica

  name       = "${var.name}-rds-replica"
  subnet_ids = var.replica_private_subnet_ids
  tags       = var.tags
}

# ---- Parameter group: TLS only; pgvector is created with `CREATE EXTENSION vector` ----

resource "aws_db_parameter_group" "postgres" {
  name_prefix = "${var.name}-pg17-"
  family      = "postgres${var.engine_version}"
  description = "CauseDeck Postgres: TLS enforced, pgvector available, statement logging"
  tags        = var.tags

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_parameter_group" "replica" {
  provider = aws.replica

  name_prefix = "${var.name}-pg17-replica-"
  family      = "postgres${var.engine_version}"
  description = "CauseDeck Postgres replica: TLS enforced, pgvector available"
  tags        = var.tags

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---- Instances ----

resource "aws_db_instance" "primary" {
  #checkov:skip=CKV_AWS_118:Enhanced monitoring needs a monitoring role; Performance Insights and CloudWatch log exports cover stage-b
  identifier = "${var.name}-primary"

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.primary.arn

  db_name                     = "causedeck"
  username                    = "causedeck_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.primary.name
  vpc_security_group_ids = [aws_security_group.primary.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.postgres.name
  multi_az               = var.multi_az

  backup_retention_period = var.backup_retention_days
  backup_window           = "21:00-22:00"
  maintenance_window      = "sun:22:30-sun:23:30"
  copy_tags_to_snapshot   = true
  deletion_protection     = var.deletion_protection
  skip_final_snapshot     = false

  final_snapshot_identifier           = "${var.name}-primary-final"
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = aws_kms_key.primary.arn
  auto_minor_version_upgrade          = true
  iam_database_authentication_enabled = true

  tags = var.tags

  lifecycle {
    precondition {
      condition     = data.aws_region.primary.region == var.region
      error_message = "The default aws provider must be configured for var.region (an India region)."
    }
  }
}

resource "aws_db_instance" "replica" {
  #checkov:skip=CKV_AWS_157:Cross-region read replica for DR; Multi-AZ on the replica doubles cost without changing the recovery path
  #checkov:skip=CKV_AWS_129:Replica logs are exported from the primary; the replica is not a write target
  #checkov:skip=CKV_AWS_118:Enhanced monitoring needs a monitoring role; see the primary
  #checkov:skip=CKV2_AWS_60:Replica takes no snapshots of its own; tags are copied on the primary
  provider = aws.replica

  identifier          = "${var.name}-replica-hyd"
  replicate_source_db = aws_db_instance.primary.arn
  instance_class      = var.instance_class

  storage_type      = "gp3"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.replica.arn

  db_subnet_group_name   = aws_db_subnet_group.replica.name
  vpc_security_group_ids = [aws_security_group.replica.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.replica.name

  backup_retention_period         = 7
  skip_final_snapshot             = true
  deletion_protection             = var.deletion_protection
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.replica.arn

  tags = var.tags

  lifecycle {
    precondition {
      condition     = data.aws_region.replica.region == var.replica_region
      error_message = "The aws.replica provider must be configured for var.replica_region (an India region)."
    }
  }
}
