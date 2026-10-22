# 0022. AI gateway implementation: ports, residency, audit and idempotent results

## Status

Proposed

## Date

2026-10-22

## Context

[ADR 0007](0007-ai-gateway-india-only-mode-no-training-no-tools.md) fixed the posture: one gateway, India-only by default, no training, no tools, every call audited and budgeted. Issue #44 builds it in `packages/ai`. The surrounding pieces already exist: the append-only `ai_call` table and its writer (#226, #227), the AI budget service (#220, #30) and the `AI_PROVIDER` / `BEDROCK_*` / `SARVAM_*` env keys (#4). This ADR records the choices the build made on top of them.

## Decision drivers

- `packages/ai` depends on no domain package ([core domains](../engineering/core-domains.md)).
- `ai_call` is append-only and holds no content.
- Dev and CI call no network provider and need no secrets.

## Considered options

| Option                                                             | Verdict  | Reason                                                                                                                                       |
| ------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ports in `packages/ai`, implemented in `packages/core/src/ai`      | Chosen   | Keeps the AI package free of domain imports; budgets, settings and audit stay in their own domains                                           |
| `packages/ai` imports `core` directly                              | Rejected | Cycle (core depends on ai) and it would couple providers to the database                                                                     |
| Bedrock through the AWS SDK                                        | Rejected | One endpoint and one request shape; a small SigV4 signer keeps the request fully visible to the static no-tools check and adds no dependency |
| Bedrock through a hand-rolled SigV4 `fetch` (Converse API)         | Chosen   | As above                                                                                                                                     |
| Store idempotent output in `ai_call`                               | Rejected | `ai_call` is append-only and content-free                                                                                                    |
| `ai_call_result`, a 24 h tenant table holding the validated output | Chosen   | A job retry reuses the result; expired rows are never read and are deleted on the next write                                                 |

## Decision

- **Entry point**: `gateway.run(taskId, input, {workspaceId, matterId?, captureId?, purpose, automationLevel?, idempotencyKey?})` returns `{output, callId, provider, model, region, usage}`. Order: idempotent reuse, sensitive block, residency, injection flag, estimate, per-workspace concurrency cap, budget `reserve`, provider call with retry and failover, schema validation with one repair, `ai_call` row, budget `commit`, store the idempotent result. Any failure after `reserve` releases it.
- **Providers**: `bedrock` (Converse API, India inference profile id from config, `ap-south-1`/`ap-south-2` only count as `dataResidency: 'in'`), `sarvam` (STT, OCR, translate; `in`) and `mock`. The mock reports `in` because nothing leaves the process. The request builders send no tool, function, web or retrieval parameters; `static-checks.test.ts` fails if a provider file names one.
- **India-only**: when `workspace_settings.india_only_ai` is true, a task whose primary provider is not `in` raises `ResidencyViolationError` (audited, `status=residency_violation`) and failover only considers `in` providers.
- **Sensitive**: a sensitive matter, or a capture the caller reports `ai_blocked`, raises `SensitiveMatterBlockedError` before any provider is contacted. The audit row has `status=blocked_sensitive` and no input hash. The capture table does not exist yet, so core takes the `ai_blocked` check as an injected function until the capture inbox lands.
- **Audit**: `ai_call` gains `task`, `latency_ms`, `status`, `error_code`, `input_sha256`, `capture_id`, `matter_id`, `suspicious` and `idempotency_key` (migration 0053). Raw prompts and documents are never stored. A workspace debug flag may hand the raw payload to an optional `DebugSink` for at most 24 hours; core wires no sink and no flag column yet. `idempotency_key` is written on `ok` rows only (it is unique per workspace). Reconciliation (#225) considers `ok` rows only, because blocked and failed calls spend nothing.
- **Budgets**: the estimate is a reservation of at most `maxOutputTokens` plus the input size, pages or seconds, priced from `pricing.ts` (paise, rounded up). Output that fails validation twice releases the reservation and records cost 0.
- **No training**: Bedrock does not train on requests and has no retention parameter. Sarvam's no-training term is a contract: `createSarvamProvider` throws without `SARVAM_NO_TRAINING_CONFIRMED`, and the env schema refuses a production boot with a real `SARVAM_API_KEY` without it.
- **Sarvam request shapes** follow Sarvam's public API documentation; the recorded fixtures are hand-written from it until a key (#113) allows recording real responses. Revisit the field names then.

## Consequences

- Positive: one enforcement point; CI and dev run offline; core owns every database read and write the gateway needs.
- Negative: `ai_call_result` stores model output for 24 hours, a short-lived copy of proposal content under the same RLS as the rest of the workspace.
- Negative: until the capture inbox exists, `ai_blocked` captures are blocked only when the caller supplies the check.

## Revisit when

- Real Bedrock or Sarvam credentials (#112, #113) allow recording real responses.
- The capture inbox adds `capture.ai_blocked`.
- A workspace-level debug flag gets a settings column and UI.

## Links

- [ADR 0007](0007-ai-gateway-india-only-mode-no-training-no-tools.md)
- [Spike §6](../engineering/13-technical-architecture-spike.md#6-security-and-privacy-architecture)
- [usage metering](../engineering/usage-metering.md)
