# 0007. AI gateway with India-only mode, no training and no tools

## Status

Accepted

## Date

2026-10-18

## Context

AI extracts dates, directions and parties from court documents, transcribes hearings, and drafts briefs and client updates. The inputs are privileged and may contain hostile text (prompt injection). The permanent exclusions forbid training on customer data, autonomous advice and any L5 action. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (AI row), [§5](../engineering/13-technical-architecture-spike.md#5-domain-services-packagescore) (Outward drafts: no send path), [§6](../engineering/13-technical-architecture-spike.md#6-security-and-privacy-architecture) (prompt-injection posture) and its permanent exclusions. It also follows D-009 in [DECISIONS.md](../../DECISIONS.md).

## Decision drivers

- Customer data is processed in India by default and is never used for training.
- A document must not be able to make the AI act in the world.
- Per-workspace budgets and a complete audit of AI calls.
- Dev and CI run without provider credentials.

## Considered options

| Option                                                        | Verdict  | Reason                                                                                                     |
| ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| Gateway with Bedrock India (Claude), Sarvam and mock adapters | Chosen   | India-region endpoints under no-training terms; Indic STT and OCR; one place for budgets, audit and policy |
| Direct calls to global provider APIs from each feature        | Rejected | Data leaves India; budgets, audit and policy would be duplicated in each feature                           |
| Self-hosted open models on our VPS                            | Rejected | GPU cost and quality at bootstrap; still needs the same gateway                                            |
| Agentic tool use (AI can call send, file or update actions)   | Rejected | It turns prompt injection into real-world actions, and it is L5 by definition                              |

## Decision

- `packages/ai` is the only path to a model. Its provider adapters are **Amazon Bedrock India profile (Claude)**, **Sarvam** (STT, OCR, Indic) and a **mock provider** for dev and CI.
- Guardrails:
  - **India-only AI by default**: India-only mode is on for every workspace unless it is explicitly changed in privacy settings.
  - **No training on customer data**: providers are used only under no-training, zero- or short-retention terms (D-009).
  - **No tools and no outbound actions**: the AI cannot call functions, send, file or change data. Its outputs are schema-validated proposals that a human confirms.
  - **No L5**: nothing acts on the world without the lawyer (see [ADR 0010](0010-feature-flags-db-backed-legal-gating-and-no-l5.md)).
  - **No auto-send**: client, senior and counsel updates are drafts that the lawyer sends. There is no send path ([09 §4](../product/09-zero-entry-automation-design.md#4-the-automation-ladder--approval-boundaries)).
  - Documents are treated as data, never as instructions.
- Every call is audited (`ai_call`) and charged to a per-workspace budget.

## Consequences

- Positive: one enforcement point for residency, budgets, audit and injection posture.
- Negative: we cannot use models or features that are not available in India-region endpoints without an explicit opt-out.
- Negative: the lack of tools limits automation to proposals; every outward step costs the lawyer a tap.

## Revisit when

- India-region endpoints lose a required capability or become uneconomic (provider pricing or availability change).
- Counsel or a regulator changes the position on processing outside India. Even then, a new ADR is required, and the no-training and no-L5 exclusions stay.

## Links

- [Spike §6](../engineering/13-technical-architecture-spike.md#6-security-and-privacy-architecture)
- [ADR 0010](0010-feature-flags-db-backed-legal-gating-and-no-l5.md)
- [DECISIONS.md](../../DECISIONS.md) D-009
