# DigitalOcean BLR1 droplet for the compose stack: firewall (80, 443 tcp+udp from anywhere, SSH from
# the allowlist, nothing else inbound), a data volume and weekly droplet backups. DigitalOcean
# volumes and backups are encrypted at rest by the platform (there is no toggle).

locals {
  name    = "${var.project}-${var.env}"
  do_tags = [for k, v in var.tags : "${k}:${v}"]
  anywhere = {
    v4 = "0.0.0.0/0"
    v6 = "::/0"
  }
}

resource "digitalocean_droplet" "this" {
  name       = local.name
  region     = var.region
  size       = var.size
  image      = var.image
  ipv6       = true
  monitoring = true
  backups    = true
  tags       = local.do_tags
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_allowlist    = join(" ", var.ssh_allowlist)
    deploy_pubkey    = var.deploy_pubkey
    bootstrap_url    = var.bootstrap_url
    bootstrap_sha256 = var.bootstrap_sha256
  })

  # Weekly backup window: Sunday 20:00 UTC (01:30 IST Monday), outside court hours.
  backup_policy {
    plan    = "weekly"
    weekday = "SUN"
    hour    = 20
  }

  lifecycle {
    ignore_changes = [user_data, image]
  }
}

resource "digitalocean_volume" "data" {
  name                    = "${local.name}-data"
  region                  = var.region
  size                    = var.data_volume_gb
  initial_filesystem_type = "ext4"
  description             = "Postgres, MinIO and WAL spool data"
  tags                    = local.do_tags
}

resource "digitalocean_volume_attachment" "data" {
  droplet_id = digitalocean_droplet.this.id
  volume_id  = digitalocean_volume.data.id
}

# Firewall: the `tags` argument of digitalocean_firewall selects target droplets, so it is not used
# here; the firewall is bound by droplet id.
resource "digitalocean_firewall" "this" {
  name        = local.name
  droplet_ids = [digitalocean_droplet.this.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = [local.anywhere.v4, local.anywhere.v6]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = [local.anywhere.v4, local.anywhere.v6]
  }

  inbound_rule {
    protocol         = "udp"
    port_range       = "443"
    source_addresses = [local.anywhere.v4, local.anywhere.v6]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowlist
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = [local.anywhere.v4, local.anywhere.v6]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = [local.anywhere.v4, local.anywhere.v6]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = [local.anywhere.v4, local.anywhere.v6]
  }
}
