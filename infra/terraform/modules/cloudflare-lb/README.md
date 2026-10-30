# cloudflare-lb

Optional Stage B entry (#106). Disabled by default (`enable_cloudflare_lb = false`); the ALB in
`../aws-alb-multinode` is the default. Enabling it needs `residency_decision_ref` (D-037) and
`approval_doc`, the same rule as `app_proxied` in #99. `proxied` stays false (DNS-only) unless the
decision allows the proxy.
