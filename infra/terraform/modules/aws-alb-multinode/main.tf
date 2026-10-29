# Default multi-node entry for Stage B (#106): an AWS ALB in ap-south-1. TLS terminates inside India,
# so matter data never transits a Cloudflare edge. Cloudflare LB is the optional alternative in
# ../cloudflare-lb and needs a recorded residency decision (D-037).

data "aws_region" "current" {}

resource "aws_security_group" "alb" {
  name_prefix = "${var.name}-alb-"
  description = "HTTPS and HTTP redirect from the internet"
  vpc_id      = var.vpc_id
  tags        = var.tags

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = data.aws_region.current.region == var.region
      error_message = "The aws provider must be configured for var.region (an India region)."
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each = toset(var.ingress_cidrs)

  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS"
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  #checkov:skip=CKV_AWS_260:Port 80 only serves the redirect to HTTPS; public by design
  for_each = toset(var.ingress_cidrs)

  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = each.value
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  description       = "HTTP, redirected to HTTPS"
}

resource "aws_vpc_security_group_egress_rule" "to_app" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "10.0.0.0/8"
  from_port         = var.app_port
  to_port           = var.app_port
  ip_protocol       = "tcp"
  description       = "Health checks and traffic to the app nodes"
}

resource "aws_lb" "app" {
  #checkov:skip=CKV_AWS_91:Access logs need a dedicated log bucket; tracked with the stage-b observability work
  name                       = "${var.name}-app"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  tags                       = var.tags
}

resource "aws_lb_target_group" "app" {
  name                 = "${var.name}-app"
  port                 = var.app_port
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  tags                 = var.tags

  health_check {
    path                = var.health_check_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group_attachment" "app" {
  for_each = toset(var.app_target_ids)

  target_group_arn = aws_lb_target_group.app.arn
  target_id        = each.value
  port             = var.app_port
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_wafv2_web_acl_association" "app" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_lb.app.arn
  web_acl_arn  = var.web_acl_arn

  lifecycle {
    precondition {
      condition     = var.web_acl_arn != ""
      error_message = "enable_waf = true requires web_acl_arn."
    }
  }
}
