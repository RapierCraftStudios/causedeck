# 07 — Founder-reported findings (2026-10-17)

**Source:** founder direction message, 2026-10-17. **Tag:** `[FOUNDER-REPORTED]`. These findings were given to the research lead by the founder. The raw data (interview notes, time logs, parser tests) is **not yet in this repository**. Treat them as decision inputs with medium confidence until the underlying data is added under `research/primary/`.

| # | Finding | Hypothesis it bears on | Pre-registered rule triggered (v0.2) |
|---|---|---|---|
| F1 | Solo lawyers report **under 30 minutes a day** of admin savings | H-TIME0 / H-TIME1 ([07 v0.2](../../docs/validation/07-validation-plan.md)) | "< 30 min: retarget chambers (S4) or junior-for-senior admin" ([04 v0.2 §9](../../docs/mvp/04-mvp-definition.md)) |
| F2 | **Confidentiality makes lawyers reluctant to forward client messages** | H-PRIV | "Lead with own voice notes, lists and orders only" |
| F3 | **Cause-list parsing is court-specific** | H-LIST / spike T6 | "Restrict launch courts; manual-paste fallback" |
| F4 | **Chamber-level aggregation may create stronger value** | H9 (seniors pay for chamber-wide time back) | Supports a chamber-first buyer |

## Interpretation `[I]`
- Admin per solo is small, but it **multiplies across a chamber**. The senior's real cost is coordination: "what happened in Court 4?" calls, juniors re-typing the board, the clerk copying lists. One chamber of 4–6 people × 15–30 min/day can come to 1.5–3 person-hours a day, plus the senior's interruptions. This is an inference, and the chamber baseline in E1-C must test it.
- Client-originated inputs are now **out of the MVP**. Lawyer-owned inputs (voice notes, order PDFs, cause-list PDFs, calendar/diary exports) carry no third-party forwarding consent problem for the chamber. Order PDFs and cause lists are court documents, and voice notes are the lawyer's own work product.
- Court-specific parsing turns from a weakness into a **distribution property**. Once one court's parser works, every chamber at that court gets zero-setup value. Launch court by court.

## Founder correction (later the same day) and how F1–F4 are now used
A chamber "court-day autopilot" framing was drafted in response to F1–F4. The founder **rejected it** the same day: Lawyer OS must remain a full intelligent operating layer, with the MVP as a vertical slice, and launch in **Madras HC + Bengaluru**, delivered as a multi-tenant SaaS. F1–F4 now shape the slice rather than redefine the product:

| Finding | How it is used now (D-024 to D-034) |
|---|---|
| F1 (< 30 min/day saved for solos) | Proof of value is **preparation, kept obligations, lower cognitive load and continuity**, not minutes of entry avoided (D-030) |
| F2 (confidentiality and client forwards) | Inputs are **lawyer-owned first**. Email and WhatsApp exports are opt-in, internal-chat-first and privacy-gated. Client chats are excluded by default (D-029) |
| F3 (court-specific parsing) | **Court-adapter architecture** with maturity levels; launch adapters only for Madras HC and Karnataka HC at A1 (D-028) |
| F4 (chamber aggregation) | **Chamber plan** is packaging and a distribution engine inside the OS, not the product's identity (D-031) |

## Action
Recorded as inputs to D-024 to D-034 in [DECISIONS.md](../../DECISIONS.md). **Data debt:** the founder should add the anonymised interview notes and time logs behind F1–F4 to `research/primary/` so the decision trail can be audited.
