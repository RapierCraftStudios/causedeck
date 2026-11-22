# Drafting system templates

System templates (#76) are the scaffolds every workspace can copy: `template` rows with a null
`workspace_id` (`is_system` is generated from that). Workspaces can only read them (`global_read`);
copying one into a workspace inserts a new row owned by that workspace. Only the owner role writes
system rows (`owner_catalogue`, ADR 0013).

## Where things live

- Registry: `packages/drafting/src/system-templates/` (`index.ts` lists them; one file per template under
  `madras-hc/`, `karnataka-hc/`, `generic-a0/`). `defineTemplate` computes the sha256 checksum.
- Seeder: `packages/db/src/seed/system-templates.ts` takes the entries as a parameter (db may not import
  drafting). `packages/core/scripts/seed-system-templates.ts` passes the registry and runs as the owner
  after `pnpm db:migrate` on every deploy.
- Labels for the UI: `packages/i18n/src/messages/*/drafting-templates.json`.

## How to add a template

1. Add `<kind>.ts` under the court folder. Build the tree with the helpers in `common.ts`. Case-type
   labels come from `madrasCaseTypes` / `karnatakaCaseTypes` (the adapters catalogue); never type a
   label, hall or bench phrase.
2. Use `defineTemplate` with a stable `code` (`<court>.<kind>`, never renamed) and register it in
   `index.ts`.
3. Recipient slots: a client letter reads `client.name` only. There is no slot for other recipients.
4. Add the label in the three `drafting-templates.json` files, run `pnpm --filter @causedeck/i18n
   i18n:types`, and add the `draft` status lines to `translation-status.json`.
5. Update the snapshot (`system-templates.test.ts`) and review the diff.

## Checksum and version rule

The seed rewrites a row only when its checksum differs. Any wording change changes the checksum, so
bump `semver` with it (the seed stores the major in `template.version`). Unchanged rows keep
`updated_at`. A reseed with a new checksum also resets `reviewed_by` to the seed value (null), so
changed wording is reviewed again.

## Banner rule

Every export of a template whose `reviewed_by` is null carries `Scaffold: review before use` (DOCX and
PDF), and the `draft.exported` audit event records `bannerShown`. Set `reviewed_by` only after a
practising advocate signed the wording off.

## Review checklist

- No legal citation or authority (`system-templates.test.ts` lints the patterns).
- No advice, commitment, fee quote or solicitation (phrase denylist in the same test).
- Court nomenclature from the adapters catalogue; snapshot renders with the court preset.
- Tamil and Kannada content switches the complex-script font (DOCX) and embeds glyphs (PDF).
- Labels exist in `en` with `ta` and `kn` entries.

## Authority insertion

Two services in `packages/core/src/drafting/authorities.ts` (#1142) put a verified corpus authority
into a draft. Neither sends or shares anything (ADR 0045); the lawyer chooses and confirms.

- **Propose** (`proposeAuthorities`, `draft.read` and a readable matter): the text of one block is
  the question to `askCopilot`, with the draft's matter, so it is metered as one `copilot.questions`
  unit (idempotent on `requestId`), stopped at the Junior cap, and a sensitive matter returns
  `aiBlocked` with no model call and nothing counted. Only corpus claims (`seg`, with a judgment) are
  kept, and each must also pass `verifyPinpoint` against `judgment.redacted_text`, the text insert
  checks. Each candidate carries its paragraph or page and the corpus link; none gives `noAuthority`.
  Propose writes nothing to the draft.
- **Insert** (`insertAuthority`, `draft.write`): the client sends the judgment id, the quote and the
  paragraph or page only. Insert re-runs `verifyPinpoint`; a changed quote, judgment id or pinpoint
  gives `VALIDATION` and nothing is saved. A base version that is no longer the latest gives
  `CONFLICT`. The title (the masked one) and citation (neutral citation, else the first case number)
  come from the stored judgment. The paragraph `"<quote>" — <masked title>, <citation>, para N`
  (`paras N-M`, or `at p. N` for a page; `formatAuthorityParagraph` in `@causedeck/drafting`) is
  added after the chosen block and saved as the next immutable version through `insertVersion`, with
  `draft.authority.inserted` (ids and the text's sha256 only) in the same transaction; the citation
  check is queued like `saveVersion`.
- **Round trip**: `extractCitations` reads the paragraph back with the same citation, pinpoint and
  quote (a quote set off by a dash before the title or citation; a trailing quote still wins), so
  `checkDraft` verifies it against the corpus. If the stored text later stops matching, the export
  gate holds the draft until a lawyer acknowledges the citation with a reason
  (`draft.citations.acknowledged`).
