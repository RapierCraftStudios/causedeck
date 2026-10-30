# stage-b root (#106). Composition of the Stage B modules. Plan-able with dummy credentials
# (terraform.tfvars.example); it is never applied automatically. Apply is a manual, gated step in
# .github/workflows/terraform.yml and happens only at cutover (infra/runbooks/stage-b-scale-out.md).
# The app consumes the outputs only through DATABASE_URL, S3_BUCKET and S3_REGION.

locals {
  env = "stage-b"

  tags = {
    project        = "causedeck"
    env            = local.env
    owner          = var.owner
    data_residency = "in"
  }
}

provider "aws" {
  region                      = var.aws_region
  skip_credentials_validation = var.plan_with_dummy_credentials
  skip_requesting_account_id  = var.plan_with_dummy_credentials
  skip_metadata_api_check     = var.plan_with_dummy_credentials
}

provider "aws" {
  alias                       = "replica"
  region                      = var.replica_region
  skip_credentials_validation = var.plan_with_dummy_credentials
  skip_requesting_account_id  = var.plan_with_dummy_credentials
  skip_metadata_api_check     = var.plan_with_dummy_credentials
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

module "rds" {
  source = "../../modules/aws-rds-postgres"

  providers = {
    aws         = aws
    aws.replica = aws.replica
  }

  name                       = "causedeck-${local.env}"
  region                     = var.aws_region
  replica_region             = var.replica_region
  account_id                 = var.account_id
  kms_admin_role_arns        = var.kms_admin_role_arns
  kms_user_role_arns         = var.kms_user_role_arns
  vpc_id                     = var.vpc_id
  private_subnet_ids         = var.private_subnet_ids
  replica_vpc_id             = var.replica_vpc_id
  replica_private_subnet_ids = var.replica_private_subnet_ids
  allowed_security_group_ids = var.app_security_group_ids
  multi_az                   = var.multi_az
  tags                       = local.tags
}

module "documents" {
  source = "../../modules/aws-s3-documents"

  providers = {
    aws         = aws
    aws.replica = aws.replica
  }

  name                = "causedeck-${local.env}"
  region              = var.aws_region
  replica_region      = var.replica_region
  account_id          = var.account_id
  kms_admin_role_arns = var.kms_admin_role_arns
  app_role_arns       = var.app_role_arns
  tags                = local.tags
}

# The ALB is the default multi-node entry (TLS terminates in India).
module "alb" {
  source = "../../modules/aws-alb-multinode"

  name              = "causedeck-${local.env}"
  region            = var.aws_region
  vpc_id            = var.vpc_id
  public_subnet_ids = var.public_subnet_ids
  certificate_arn   = var.certificate_arn
  app_target_ids    = var.app_target_ids
  tags              = local.tags
}

module "cloudflare_lb" {
  source = "../../modules/cloudflare-lb"

  enable_cloudflare_lb   = var.enable_cloudflare_lb
  residency_decision_ref = var.residency_decision_ref
  approval_doc           = var.approval_doc
  account_id             = var.cloudflare_account_id
  zone_id                = var.cloudflare_zone_id
  hostname               = "app.${var.domain}"
}

module "ecs" {
  source = "../../modules/aws-ecs-fargate"

  enabled = var.enable_stage_c
  name    = "causedeck-${local.env}"
  region  = var.aws_region
  tags    = local.tags
}

module "elasticache" {
  source = "../../modules/aws-elasticache"

  enabled            = var.enable_stage_c
  name               = "causedeck-${local.env}"
  region             = var.aws_region
  subnet_ids         = var.private_subnet_ids
  security_group_ids = var.app_security_group_ids
  tags               = local.tags
}
