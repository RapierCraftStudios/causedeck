# 00 — Executive Summary

2026-10-17 · Research → PRD → MVP package v0.1 · Read time about 5 minutes.

## Recommendation
Build **Lawyer OS** as a **mobile-first matter and hearing diary for young litigators**. It should turn every hearing, order and voice note into a confirmed next date, tasks and a client update, and it should explicitly remember how each lawyer practises. Its AI works only on the lawyer's own material and **never generates a citation**.

- **Who:** start with junior and independent litigators (0–7 years) in one court ecosystem, by default Delhi's district courts and High Court.
- **Price:** a free tier for students and juniors, and a Pro plan to be tested at **₹299–499/month**.
- **What we won't do:** compete on legal-research content, or build anything that helps lawyers market themselves to the public.

## Why this, why now
1. **The gap is real (desk evidence).**
   - AI research is crowded and sold at a premium: CaseMine AI Pro ₹29,999/yr, Manupatra Starter ₹14,250 with 5 AI summaries a month, SCC AI Pro a reported +₹48,500, and Indian Kanoon Prism ₹5,000/yr.
   - Daily practice tools are either enterprise and demo-gated (Provakil, MyKase) or AI-less diary apps.
   - The official eCourts app is rated 2.4★ on iOS, with complaints about lost cases and offline access being removed.
2. **The next date is the atomic unit of litigation.**
   - NJDG shows 5.16 crore cases pending in district courts (14 Oct 2026).
   - Adjournments dominate court time.
3. **Courts have made unsafe AI costly.** The Supreme Court (*Gummadi Usha Rani*, Feb 2026; *Pooja Ramesh Singh v. J&K Bank*, Jul 2026) treats unverified AI citations as misconduct. That makes "verification-first, never invents law" a selling point.
4. **The economics now work.**
   - Claude is available in-country on Bedrock India with zero data retention by default (since 29 Sep 2026).
   - Sarvam provides Indic speech-to-text at ₹0.49/min and OCR at ₹0.50/page.
   - Our estimated variable cost is about **₹100 per Pro user per month**, against a ₹299–499 price.
5. **The audience is there.** About 2.3–2.5 lakh AIBE candidates a year, Android ~94% of mobile traffic, and UPI everywhere.
6. **The constraints are clear.**
   - Rule 36, the Madras HC aggregator order and BCI's 2025 crackdown on lawyer advertising rule out marketing tools. "CRM" must mean managing existing clients only.
   - DPDP duties start in May 2027 and CERT-In applies now. Both favour an India-hosted, privacy-first design.

## The MVP (12 weeks of build after a 4-week validation gate)
Includes:
- Diary with a confirmed next date and its source, plus a Tomorrow/Today view and reminders.
- Voice note → structured hearing update.
- Order PDF digest anchored to page and quote.
- Client update the lawyer shares themselves on WhatsApp.
- Explicit memory: confirm-before-save, editable, scoped to each matter.
- Three safe drafting templates, a citation checker and a consistency check.
- Fee log.
- eCourts lookup driven by the user on the device, *only if counsel clears it*.
- Offline use, app lock and full export.

Excludes: research, marketing, client portals, invoices, limitation calculation, chamber accounts, native desktop, and bulk scraping.

## Main uncertainties
1. **Willingness to pay.** Juniors earn under ₹10k/month, and we found no evidence that any diary app converts to paid. This is the top risk (score 20).
2. **Real workflows.** We have no primary data on how juniors track lists, clerks and fees; Reddit and LinkedIn were unreachable. Every workflow claim is a hypothesis until we run 20 interviews.
3. **Court-data access.** There is no public eCourts API, the portal's terms are unknown, and reseller prices are unpublished. The product must stand on its own without automated court data.
4. **Legal points needing counsel** ⚖:
   - the current BCI Rule 36 text and website Schedule;
   - the status of the Sulekha/JustDial appeals in the SC;
   - the eCourts lookup approach;
   - the DPA and privilege terms;
   - the ambassador programme.
5. **AI extraction accuracy** on real, often scanned or Hindi, orders. The target is ≥98% on next dates, with the user confirming.

## Next three concrete actions
1. **Run Stage 0 interviews and the concierge pilot (weeks 0–4).** Do 20 litigator, 6 senior and 4 student interviews using the [script](validation/07-validation-plan.md#2-interview-programme), plus a 2-week WhatsApp concierge pilot with 10 lawyers. This tests H1–H3, H8–H10.
2. **Launch the pricing fake-door and founding-member pre-order.** Use three price arms (₹299/₹399/₹499) and a ₹1,999/yr refundable pre-order to the waitlist. This tests H6–H7. Engage Indian tech and professional-ethics counsel the same week with the ⚖ list in the [risk register](risk/06-risk-register.md#items-needing-qualified-indian-legal--tax-review--list).
3. **Build the 200-order gold set and run spikes T1–T3.** That covers on-device eCourts lookup, order-digest accuracy and cost on Bedrock India, and Hinglish speech-to-text. Then hold the GO / PIVOT decision on the [Stage 0 gate](validation/07-validation-plan.md#7-stage-0-decision-meeting-end-of-week-4).

## Document map
[Research report](strategy/01-research-report.md) · [Thesis & segments](strategy/02-product-thesis-and-segmentation.md) · [PRD](product/03-prd.md) · [MVP](mvp/04-mvp-definition.md) · [Matrices](strategy/05-competitor-and-ai-matrices.md) · [Risks](risk/06-risk-register.md) · [Validation](validation/07-validation-plan.md) · [Repo & backlog](engineering/08-repo-structure-and-backlog.md) · [Decisions](../DECISIONS.md) · [Assumptions](../ASSUMPTIONS.md)
