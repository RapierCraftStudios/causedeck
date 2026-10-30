output "db_primary_ipv4" {
  description = "Postgres primary public IPv4 (firewall 5432 and 6432 to the app and replica nodes only)."
  value       = module.db_primary.ipv4
}

output "db_replica_ipv4" {
  description = "Postgres streaming replica public IPv4."
  value       = module.db_replica.ipv4
}

output "app_ipv4s" {
  description = "App node IPv4 addresses by node number; these become the DNS-only app and api records."
  value       = { for k, m in module.app : k => m.ipv4 }
}

output "app_ipv6s" {
  description = "App node IPv6 addresses by node number."
  value       = { for k, m in module.app : k => m.ipv6 }
}

output "node_datacenters" {
  description = "Datacenter of every node. Always YNM."
  value = merge(
    {
      "db-primary" = module.db_primary.datacenter
      "db-replica" = module.db_replica.datacenter
    },
    { for k, m in module.app : "app-${k}" => m.datacenter },
  )
}
