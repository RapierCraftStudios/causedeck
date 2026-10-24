### Approach
#486 DPDP posture for the global court-data layer: posture doc (docs/legal/court-data-posture.md, linked from D-048), `source.data_class` tag with `exposableThroughApi` (API wiring deferred to #487), `expireCourtData` retention job `system.court-data.retention`, and `eraseCourtDataSubject` with audit events `court_data.expired` / `court_data.erased`.
### Recovery
- Merged origin/milestone/court-data-network; the base took 0074 to 0078, so the migration is now 0079_source_data_class (SQL byte-identical apart from the header name). The base's 0074 snapshot and journal were restored, then the 0079 snapshot and journal entry were regenerated with drizzle-kit generate and `lint-migrations --stamp`. `drizzle-kit check` and migration lint pass.
- Not run locally: db and core tests (need a database; CI re-verifies).
