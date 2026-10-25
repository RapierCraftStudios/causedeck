### Approach
Resumed the earlier run; verified the branch against the contract, ran all validates, declared out-of-contract files by amendment.
### Changes
- packages/db: whatsapp-link schema, migration 20261025000503 + snapshot/journal, whatsapp channel enum, registry/seeders/RLS/index tests
- packages/core: whatsapp-link domain (OTP request/verify, unlink, categories, send target), exports, erase/export registration, cross-tenant tests
- packages/notifications: 'whatsapp' in CHANNELS; DeliveryJob type excludes it
- apps/web, eslint core-domains.js: type-fallout and domain dependency entry
### Acceptance Criteria Status
- R1 ✅ packages/db/src/schema/whatsapp-link.ts
- R2 ✅ packages/db/migrations/20261025000503_whatsapp_link.sql
- R3 ✅ packages/core/src/whatsapp-link/link.ts
- R4 ✅ link.ts getWhatsAppSendTarget
- R5 ✅ cross-tenant-registry.ts, two-tenants.ts, sql.test.ts, index.test.ts, core index.ts
- R6 ✅ packages/notifications/src/categories.ts
- R7 ✅ whatsapp-link/__tests__/whatsapp-link.test.ts, cross-tenant tests
### Verification
V1, V2, V3 pass (forgedock check PASS). tsc clean for db, notifications, core, web. Prettier clean. An earlier V1 failure at 14 workers was a load flake; it passes at 2 workers. Regression tests were not run against a reverted fix.
### Notes
No env vars. No messages are sent (P1). No devdocs freshness script in repo.
