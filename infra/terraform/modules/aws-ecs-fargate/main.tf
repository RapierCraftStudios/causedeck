# Stage C skeleton (#106): ECS Fargate cluster in ap-south-1. Nothing is created unless
# enabled = true. Services, task definitions and per-queue autoscaling are added when the Stage C
# triggers in infra/runbooks/stage-c-orchestration.md fire.

resource "aws_ecs_cluster" "main" {
  count = var.enabled ? 1 : 0

  name = "${var.name}-stage-c"
  tags = var.tags

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  count = var.enabled ? 1 : 0

  cluster_name       = aws_ecs_cluster.main[0].name
  capacity_providers = ["FARGATE"]
}
