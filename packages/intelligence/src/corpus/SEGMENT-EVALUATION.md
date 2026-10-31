# Segment role evaluation (#893)

Paragraph-level rhetorical roles (`classifyParagraphs`, rules plus the sequence prior, no resolver), measured by `segment-eval.ts` over `segment-fixtures.ts`.

- Set: 24 synthetic redacted judgments, 192 labelled paragraphs. Synthetic, built from wording pools per role (varied cues, numbered and plain paragraphs, one to three pages) with the label known by construction. Hand-labelled real judgments (#119) are not collected yet.
- Result: at least 0.750 required; measured macro-F1 1.000.

| Role      | Support | Precision | Recall | F1    |
| --------- | ------- | --------- | ------ | ----- |
| header    | 24      | 1.000     | 1.000  | 1.000 |
| facts     | 42      | 1.000     | 1.000  | 1.000 |
| issues    | 18      | 1.000     | 1.000  | 1.000 |
| arguments | 30      | 1.000     | 1.000  | 1.000 |
| reasoning | 48      | 1.000     | 1.000  | 1.000 |
| decision  | 30      | 1.000     | 1.000  | 1.000 |

`other` has no labelled paragraphs and is not averaged.

## Limits

The fixtures and the rules were written by the same author, so this is a regression guard for the rule set, not an estimate of accuracy on real judgments. Re-measure on the hand-labelled set from #119 once it exists; low-confidence paragraphs (confidence below 0.6) go to the gateway resolver in production, which this report does not exercise.
