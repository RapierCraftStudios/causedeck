// The demo seed (#182, #93): two fictional workspaces, a Chennai solo advocate (Madras High Court)
// and a Bengaluru chamber (High Court of Karnataka, City Civil Court, Mayo Hall), each with 40
// matters, 60+ orders, 120+ obligations and 30 days of lists. Run it with `pnpm db:seed:demo`
// (owner role; `--workspace=chennai-solo|bengaluru-chamber|all`, `--reset`) or as part of
// `pnpm db:seed` (profile `demo`).
//
// - Fictional only: every name ends in "(fictional)", case numbers are `DEMO-NNNN`, no CNR or
//   neutral citation, `.test` emails, PDFs watermarked SYNTHETIC. No AI call is made: the seed has
//   no AI output at all, and a demo workspace refuses AI spend (`is_demo`).
// - Idempotent and deterministic: fixed ids, a seeded PRNG and `onConflictDoNothing`, so a second
//   run writes nothing. Dates are offsets from the seed day (Asia/Kolkata), so "today" rows drift
//   on later days until the workspace is reset (`--reset`, or the nightly `demo.reset` job).
// - Versioned: `DEMO_VERSION` is written to `workspace_settings.demo_version`; `organization.is_demo`
//   marks the workspace, which is what blocks outward email, push, webhooks, invitations, billing
//   and AI in it.
// - Never in production: `seedDemo` refuses when `NODE_ENV=production`. The nightly reset restores
//   demo workspaces that already exist, in any environment (`seedDemoWorkspace`).
// - The synthetic judgment corpus, news items and notices are global rows (catalogue.ts, corpus.ts): `seedDemo`
//   writes them with the owner role; the embeddings come from the content step (see below).
// - Every product module has rows (modules.ts, #985): conflict card, list diff, unreconciled
//   direction, junior handover, fees, limitation, drafts, inbox and more. Memory and the sample PDFs
//   need `@causedeck/storage`, which `@causedeck/db` cannot import: `pnpm db:seed:demo:content`
//   (`@causedeck/core`) seals the memory (`demoMemory`), uploads the PDFs (`demoDocumentPdfs`) and embeds
//   the corpus segments with the mock embedder.
import { registerSeed } from '../index.ts';

import { seedDemo } from './seed.ts';

export {
  demoBillingRows,
  DEMO_INVOICE_SERIES,
  financialYear,
  type DemoBillingRows,
} from './billing.ts';
export {
  DEMO_SOURCES,
  demoNewsRows,
  demoNoticeRows,
  NOTICES as DEMO_NOTICES,
  refreshDemoCatalogue,
  seedDemoCatalogue,
} from './catalogue.ts';
export {
  DEMO_CORPUS_SOURCE_ID,
  DEMO_CORPUS_VERSIONS,
  DEMO_JUDGMENT_COUNT,
  DEMO_JUDGMENTS,
  DEMO_SUBJECT_AREAS,
  DEMO_TAG_MODEL_VERSION,
  demoCorpusRows,
  demoJudgmentsCiting,
} from './corpus.ts';
export { demoCourtRows } from './courts.ts';
export { DEMO_FORUM_KEYS, forumId as demoForumId, type DemoForumKey } from './courts.ts';
export {
  DEMO_MATTERS_PER_WORKSPACE,
  demoCaseNumber,
  demoMatterRows,
  matterSpecs,
} from './matters.ts';
export {
  demoDocumentPdfs,
  demoModuleRows,
  DEMO_STATUS_LINK_TOKEN,
  type DemoModuleRows,
} from './modules.ts';
export { DEMO_HASH_DAY, DEMO_VERSION, demoContentHash } from './meta.ts';
export { DEMO_PDF_HEADING, DEMO_PDF_WATERMARK, demoOrderPdf } from './pdf.ts';
export {
  DEMO_USERS,
  demoMember,
  demoOrganization,
  demoUsers,
  fictional,
  type DemoUser,
} from './people.ts';
export {
  demoMemory,
  type DemoMemory,
  type DemoMemoryItem,
  type DemoMemoryProposal,
} from './memory.ts';
export {
  addDays,
  demoId,
  ID_KIND,
  seedInstant,
  DEMO_EMAIL_DOMAIN,
  FICTIONAL_SUFFIX,
  kolkataToday,
  visitorEmail,
  visitorEmailPattern,
} from './shared.ts';
export {
  DEMO_WORKSPACE_KEYS,
  DEMO_WORKSPACES,
  demoWorkspace,
  demoWorkspaceBySlug,
  isDemoWorkspaceKey,
  type DemoWorkspaceKey,
  type DemoWorkspaceSpec,
} from './workspaces.ts';

export { resetDemoWorkspace, type DemoResetResult } from './reset.ts';
export {
  DEMO_FLAG_OVERRIDES,
  DEMO_GATED_FLAGS,
  enableDemoGatedFlags,
  DemoSeedInProductionError,
  seedDemo,
  seedDemoWorkspace,
  type SeedDemoOptions,
} from './seed.ts';

registerSeed({
  name: 'demo-workspace',
  profiles: ['demo'],
  order: 20,
  run: (db) => seedDemo(db),
});
