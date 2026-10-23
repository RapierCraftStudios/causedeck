# 0033. Bootstrap import: a stored plan, a confirm grid, one apply and an undo

## Status

Proposed

## Date

2026-10-23

## Context

Issue #57 brings a lawyer's existing work into the product: cause lists, orders and diary photos dropped into one batch become matters, proceedings and hearings. The engine (#548) reads each file with the adapter ladder ([ADR 0032](0032-generic-a0-adapter.md), [ADR 0028](0028-anchored-extraction.md)), keeps only rows that match the member's enrolment numbers or names, and clusters them into proposed matters. `applyImportPlan` and `undoImportBatch` (#549) write and reverse the result, the worker job and actions (#550) run it, and the route and confirm grid (#551, #552) are the surface. The tables are `import_batch`, `import_batch_file` and `import_plan` (#546). Nothing may be created on a guess: the lawyer confirms, and can undo.

## Decision drivers

- Only matched rows are ever stored: rows that did not match are a counter, never content.
- A conflicting date is never resolved by the code. The lawyer picks one, and no "confirm all" skips a conflict.
- One apply per batch, with the plan hash recorded, so a repeat call cannot create twice.
- The whole import is reversible from one place.
- The browser journeys must be testable without a job worker.

## Considered options

| Option                                                                  | Verdict  | Reason                                                                                         |
| ----------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Create matters as each file is read                                     | Rejected | Nothing is confirmable or undoable; a wrong match is already in the lawyer's diary             |
| Store the plan, edit it in a grid, then apply it once                   | Chosen   | Reading, review and writing are separate steps; the stored plan is the thing the lawyer sees   |
| Keep the plan in the browser only                                       | Rejected | A reload or a second device loses the work; the worker cannot hand over a plan it never stored |
| Let the apply pick the date when sources disagree                       | Rejected | A confident wrong hearing date is the failure the product cannot afford                        |
| Test the flow with a real worker in e2e                                 | Rejected | The e2e stack has no worker; seeded batches exercise the same pages and actions                |

## Decision

- **Batch and plan**: `import_batch` carries the status (`pending`, `processing`, `ready`, `applied`, `undone`, `failed`), `import_plan` the plan as one JSON object per batch. The worker writes both; the page only reads them.
- **Review**: the stepper polls progress and, when the batch is `ready`, `Review the plan` loads the stored plan into the confirm grid. `?batch=<id>` resumes a batch already being read. A host that passes `onPlanReady` takes over instead of the grid.
- **Edits**: merge, split, move and rename change the grouping only. The grouping is saved with `saveImportPlanEditsAction` just before the apply, and only when it differs from the stored plan.
- **Conflicts**: a matter with `conflicting_dates` blocks the confirm until a date is picked; picked dates travel as `resolvedDates` in the decisions.
- **Apply and undo**: `applyImportPlanAction` runs `applyImportPlan` with the lawyer's decisions and returns counts; `undoImportBatchAction` reverses the batch. The result offers "Open your first court-day view".
- **Tests**: Playwright journeys seed a batch and plan by SQL (`e2e/tests/product/import-helpers.ts`) and open the page with `?batch=`. `@visual` specs cover nine states in the 360/768/1280 light and dark projects; baselines are generated only by the e2e workflow's `update_snapshots` dispatch, and each visual test skips until its baseline exists. Storybook stories cover each state (`import-states.stories.tsx`, `confirm-grid.stories.tsx`).

## Consequences

- Positive: the lawyer sees and corrects everything before it exists; one apply and one undo; the journeys run in CI without a worker.
- Negative: the seeded plans can drift from what the worker writes, so the plan shape is owned by `ImportPlan` in `@causedeck/core/import` and the helpers must follow it; per-file issues (retry, keep as attachment) are not yet listed in the grid.
- Follow-ups: per-file issue listing in the grid; baselines from the first `update_snapshots` run.

## Revisit when

- The worker can run in the e2e stack, so journeys can start from an upload.
- A plan can exceed what one JSON column and one grid page hold comfortably.
- Per-file recovery actions get their own server actions.
