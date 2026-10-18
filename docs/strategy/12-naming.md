# 12 — Product Naming

Status: **Working title chosen: CauseDeck (D-035, 2026-10-18)**. Final-name checks still pending · 2026-10-18 · "Lawyer OS" is a working title only. The founder dislikes it, and it is too generic to protect.

## 1. Naming criteria
1. **Court-native.** Indian advocates should recognise it instantly from daily practice, in Chennai, Bengaluru and beyond. It should not be Hindi-belt-only.
2. **Signals an operating layer**, not a diary, clerk or data-entry tool (D-024). It must also not suggest a legal-services provider (D-032, Rule 36).
3. **Pronounceable** for Tamil, Kannada, Hindi and English speakers, with no negative meaning in those languages.
4. **Ownable.** No conflict with Indian legal-tech names, a plausible trademark in classes 9/42 (software/SaaS), and an obtainable domain and handles.
5. **Expandable.** It must still work when the product covers research, drafting, billing and more courts.

## 2. Screened out
| Name / pattern | Reason |
|---|---|
| Kacheri | **Taken.** Kacheri Diaries / "Kacheri Draft" is an Indian AI legal drafting and case tool (UP startup portal listing). |
| Vakalat-* | Vakalat Diary exists. |
| Nyaya-* | Crowded. Nyayanidhi already calls itself a "litigation OS". |
| Adalat-* | Adalat AI. |
| *-Saathi / *-Sathi | Vakeel Saathi, LawSathi (an AI-native practice platform; a direct competitor to note). |
| Munshi, Junior, Clerk | Frames the product as admin or a person doing legal work (rejected framings). |
| Tareekh | Hindi-belt idiom; "tareekh pe tareekh" carries a negative connotation of endless adjournments. |
| Causeway | Causeway Technologies, a UK software company, is a likely class 9/42 conflict. |
| "Lawyer as a Service" | Reads as an offer of legal services (D-032). |

## 3. Shortlist (desk-screened 2026-10-18; trademark search not yet done)
| Candidate | Meaning / story | Strengths | Risks found |
|---|---|---|---|
| **Coram** | Latin for "in the presence of". It heads every Indian order and cause list ("CORAM: HON'BLE MR. JUSTICE…") | Seen daily by every litigator in every court. Short, pan-Indian, easy to say. Suggests "everything about your matter, in one presence". No legal-software conflict found in web search | `coram.in`, `coram.app`, `getcoram.com` and `usecoram.com` resolve (likely held or parked). `coram.legal` showed no A record. Common word, so the trademark is weaker. Slight association with the bench, but we never do judge analytics (D-027) |
| **Sanad** | The advocate's enrolment certificate, the licence to practise | The profession's identity document. Pan-Indian. Signals "built for advocates". No Indian legal-tech conflict found | Also a common Arabic word and personal name, so many unrelated businesses use it. `sanad.in`, `sanad.app` and `sanad.legal` resolve. Does less to signal an "operating layer" |
| **Listed** | Every litigator's daily question: "Is it listed?" | Plain English, instantly understood, product-led ("Listed — the practice OS") | Generic word, hard to trademark or rank in search. Leans toward the court-day feature rather than the whole OS. `listed.legal` showed no A record |
| **Coined option** (e.g. a blend of a court term with "OS") | — | Fully ownable | Needs a naming sprint. Less instantly meaningful |

**Update 2026-10-18:** **Coram AI** (US AI video security, $66M raised, coram.ai) is a software/AI-class brand conflict, so the Coram recommendation is withdrawn. See §5 for the founder's requested style.

~~**Research lead's recommendation:** **Coram**~~, positioned as *"Coram — the practice OS for Indian advocates"*. It is the most court-native and pan-Indian of the candidates, and it scales beyond any single feature. Before committing:
- run an IP India trademark search (classes 9, 42, 45);
- check the domain or acquisition path: `coram.legal`, a `.co.in`, or a purchase;
- secure the Play Store, X/LinkedIn and GitHub handles;
- run a 10-lawyer gut-check in Chennai and Bengaluru (pronunciation, associations).

## 4. Next steps
1. The founder picks a direction or candidate.
2. Trademark search plus domain and handle checks.
3. Lawyer gut-check (part of the E6 interviews).
4. Record the decision as D-035 and rename docs and the repo. GitHub keeps redirects after a rename.

Sources: Kacheri listing on the UP startup portal (https://www.startinup.up.gov.in/crm/Welcome/startup_user_details/Mzc1NDM=), LawSathi (https://lawsathi.in/about-us/), Nyayanidhi coverage (https://www.outlookbusiness.com/corporate/bengaluru-start-up-nyayanidhi-raises-2-mn-seed-to-build-indias-litigation-os). All accessed 2026-10-18. Domain checks are DNS-resolution only, not registry WHOIS.


## 5. Founder style brief (2026-10-18): two short words, no space
The founder's house style is UltraNews, AlterLab, ForgeDock: two short words joined, no space, punchy. The result is a **working title** good enough to create the repo; a final name comes later.

### Screened longlist
Checks: DNS resolution for .com, .app and .in (a resolving domain is likely already registered). Web conflict search was run only on the names marked †.

| Name | Story | .com | .app | .in | Conflicts found |
|---|---|---|---|---|---|
| **CauseDeck** † | The cause list is the lawyer's deck for the day; also suggests a command deck | free? | free? | free? | None (closest: cDeck, a workplace chat tool) |
| **BarTrail** | The Bar, plus the trail of a matter (timeline, continuity) | free? | free? | free? | Not searched |
| **ChamberDeck** | The chamber's command deck | free? | free? | free? | Not searched; leans "chamber" (a rejected framing) |
| **AlterBar** | AlterLab family name, plus the Bar | free? | free? | free? | Not searched; tied to the AlterLab brand |
| **BriefLab** † | Where every brief gets prepared (AlterLab-style) | free? | taken? | free? | "Brief Legal Software" (Canadian legal accounting): moderate risk |
| **CaseLoop** † | The prepare → execute → follow-up loop | free? | taken? | taken? | LawLoop (US legal portal) is similar: moderate risk |
| CoramDesk / CoramLab † | "CORAM:" on every order | free? | free? | free? | **Coram AI**: avoid |
| BriefDock | Briefs + dock (ForgeDock family) | taken? | free? | free? | Not searched |
| CaseLoom | Weaving the matter graph | taken? | free? | free? | Not searched |
| CourtLoom | Same idea, at court scale | taken? | free? | free? | Not searched |
| MatterLoop | The OS loop around each matter | taken? | free? | free? | Not searched |
| MatterKeep | Keeps every matter and obligation | taken? | free? | free? | Not searched |
| BriefRelay / CaseRelay | Handover and continuity | taken? | free? | free? | Not searched |
| ListLoop / ListDay | The daily cause-list rhythm | taken? | free? | free? | Not searched; feature-narrow |
| LexDock | Lex + dock | taken? | free? | free? | "Lex" is crowded |
| UltraBrief / ForgeBrief | Your brand families | taken? | free? | free? | Not searched |
| DayBrief, CourtDeck, CourtDay, CourtPilot, BriefPilot, BenchLine, NextDate, DayDocket | — | taken? | mostly taken | — | Weak availability |

**Research lead's pick for the working title: CauseDeck.** It is court-native: every Indian litigator lives by the cause list. It reads as a command deck for the practice (operating layer, not diary), it is two short words in the house style, and the .com, .app and .in domains all looked unregistered with no conflict found. Runner-up: **BarTrail**, which carries a continuity story.
