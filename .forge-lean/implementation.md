forge-stamp: issue=1188 contract=dbf056803ae6

### Approach
`detectSensitiveCategory` matched MATRIMONIAL against the whole judgment (`|| MATRIMONIAL.test(all)`), so any passing mention of divorce, s.498A or "matrimonial" masked an ordinary case. Matrimonial is now read only from the title plus the first 4000 characters of page 1 (case type, cause title, statute header). POCSO, sexual offence, juvenile, in-camera and acquittal keep their scopes. REDACTION_VERSION goes to 2 so the existing `system.corpus.redact` job re-redacts stored rows.

### Changes
- packages/intelligence/src/corpus/redact/sensitive.ts: `MATRIMONIAL_HEAD_CHARS = 4000`; matrimonial tested on `title + pages[0].slice(0, 4000)` only; whole-text clause removed.
- packages/intelligence/src/corpus/redact/sensitive.test.ts (new): 3 not-matrimonial cases from the issue, the HMA appeal and the 498A quashing petition, title-only, deep-in-page-1 cut-off, and POCSO, s.376 IPC and JJ Act detected when they appear only in the body.
- packages/intelligence/src/corpus/redact/version.ts: REDACTION_VERSION 1 -> 2, with a comment on the change.
- packages/db/src/seed/demo/corpus.ts: DEMO_CORPUS_VERSIONS.redaction 1 -> 2 (pinned by core content.test.ts).
- packages/intelligence/src/corpus/redact/EVALUATION.md: header version 1 -> 2. This is the committed report that eval.test.ts (G1) compares byte-for-byte; it was added through an amendment.

### Acceptance Criteria Status
- R1 ✅ packages/intelligence/src/corpus/redact/sensitive.ts:46-49
- R2 ✅ packages/intelligence/src/corpus/redact/sensitive.test.ts:14-75
- R3 ✅ packages/intelligence/src/corpus/redact/sensitive.ts:41-43 (unchanged); sensitive.test.ts:97-117
- R4 ✅ packages/intelligence/src/corpus/redact/version.ts:9; packages/db/src/seed/demo/corpus.ts:38
- R5 ✅ sensitive.test.ts:53-75; redact.test.ts matrimonial fixture still masked (G1 passes)
- R6 (guidance) ✅ whole-text clause removed, sensitive.ts:49

### Verification
- V1 `vitest run src/corpus/redact`: 3 files, 46 tests pass (exit 0).
- V2 core `content.test.ts`: 6 pass (exit 0).
- G1 redact.test.ts + eval.test.ts: 35 pass (exit 0). It failed until EVALUATION.md was updated for the version change.
- Against the base sensitive.ts, the new test file fails 4 tests, including the repro "does not mark a criminal appeal citing a divorce precedent as matrimonial". With the fix all 11 pass.
- tsc --noEmit for intelligence and db: clean. lane-check lint on changed files: clean. Prettier was run on all changed files.

### Notes
- Behaviour change: a judgment whose only matrimonial signal is in the body (or deeper than 4000 characters into page 1) is no longer masked. After deploy, staff must queue `system.corpus.redact` so stored rows at redactionVersion 1 are re-redacted.
- No env vars.

## CI fix: e2e (1/2)
e2e specs (drafting/authority-insert, drafting/citations, research/statutes) seed judgments with redaction_version 1, which the REDACTION_VERSION bump to 2 makes stale for the redact backlog job (re-redaction/re-segmentation of fixtures mid-test). Seeded versions raised to 2 (segmented_redaction_version 2). Run logs were not available (run still in progress), so this is the inferred cause.

### CI re-check (run 45562038596)
The failing run is on aaedad21, which already contains the e2e seed fix, so it is not evidence against it. Job "e2e (1/2)" was still in_progress with no readable log (e2e (2/2) passed). No failing spec could be identified, so no further code change was made. I checked that no other e2e file references redaction_version, matrimonial or masked-title behaviour. If shard 1 still fails once logs are complete, read the failing spec id from them.
