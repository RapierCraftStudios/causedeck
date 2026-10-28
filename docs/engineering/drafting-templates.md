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
