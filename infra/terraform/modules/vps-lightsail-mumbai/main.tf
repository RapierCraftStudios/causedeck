# AWS Lightsail instance in ap-south-1 (Mumbai): static IP, dual-stack, public ports 80 and 443
# (tcp+udp) from anywhere, SSH from the allowlist, a data disk and a daily automatic snapshot.
# Lightsail disks and snapshots are encrypted at rest by AWS (there is no toggle).

locals {
  name = "${var.project}-${var.env}"
  az   = "${var.region}a"
  anywhere = {
    v4 = "0.0.0.0/0"
    v6 = "::/0"
  }
  ssh_v4 = [for c in var.ssh_allowlist : c if !strcontains(c, ":")]
  ssh_v6 = [for c in var.ssh_allowlist : c if strcontains(c, ":")]
}

resource "aws_lightsail_instance" "this" {
  name              = local.name
  availability_zone = local.az
  blueprint_id      = "ubuntu_24_04"
  bundle_id         = var.size
  ip_address_type   = "dualstack"
  tags              = var.tags
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_allowlist    = join(" ", var.ssh_allowlist)
    deploy_pubkey    = var.deploy_pubkey
    bootstrap_url    = var.bootstrap_url
    bootstrap_sha256 = var.bootstrap_sha256
  })

  add_on {
    type          = "AutoSnapshot"
    snapshot_time = var.snapshot_time_utc
    status        = "Enabled"
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "aws_lightsail_static_ip" "this" {
  name = "${local.name}-ip"
}

resource "aws_lightsail_static_ip_attachment" "this" {
  static_ip_name = aws_lightsail_static_ip.this.name
  instance_name  = aws_lightsail_instance.this.name
}

resource "aws_lightsail_disk" "data" {
  name              = "${local.name}-data"
  size_in_gb        = var.data_volume_gb
  availability_zone = local.az
  tags              = var.tags
}

resource "aws_lightsail_disk_attachment" "data" {
  disk_name     = aws_lightsail_disk.data.name
  instance_name = aws_lightsail_instance.this.name
  disk_path     = "/dev/xvdf"
}

resource "aws_lightsail_instance_public_ports" "this" {
  instance_name = aws_lightsail_instance.this.name

  port_info {
    protocol   = "tcp"
    from_port  = 80
    to_port    = 80
    cidrs      = [local.anywhere.v4]
    ipv6_cidrs = [local.anywhere.v6]
  }

  port_info {
    protocol   = "tcp"
    from_port  = 443
    to_port    = 443
    cidrs      = [local.anywhere.v4]
    ipv6_cidrs = [local.anywhere.v6]
  }

  port_info {
    protocol   = "udp"
    from_port  = 443
    to_port    = 443
    cidrs      = [local.anywhere.v4]
    ipv6_cidrs = [local.anywhere.v6]
  }

  port_info {
    protocol   = "tcp"
    from_port  = 22
    to_port    = 22
    cidrs      = local.ssh_v4
    ipv6_cidrs = local.ssh_v6
  }
}
