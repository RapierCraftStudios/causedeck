# aws-alb-multinode

The default Stage B entry for two or more app nodes (#106): an ALB in `ap-south-1`, an HTTPS listener
with TLS 1.3 policy and an HTTP to HTTPS redirect, and a target group whose health check is `/readyz`.
WAF association is off (`enable_waf = false`). Outputs: `dns_name`, `zone_id`, `target_group_arn`.

App and API hostnames stay DNS-only records pointing at `dns_name`, so TLS terminates in India (D-037).
Use `../cloudflare-lb` only after the residency decision is recorded.
