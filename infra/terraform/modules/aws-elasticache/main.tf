# Stage C skeleton (#106): Redis for rate limits and cache. Nothing is created unless enabled = true.
# Encryption at rest and in transit are always on.

resource "aws_elasticache_subnet_group" "main" {
  count = var.enabled ? 1 : 0

  name       = "${var.name}-redis"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_elasticache_replication_group" "main" {
  count = var.enabled ? 1 : 0

  replication_group_id       = "${var.name}-redis"
  description                = "CauseDeck rate limits and cache"
  engine                     = "redis"
  node_type                  = var.node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.main[0].name
  security_group_ids         = var.security_group_ids
  tags                       = var.tags
}
