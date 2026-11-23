import type {
  Comparison,
  EvalReport,
  MetricComparison,
  QualityReport,
  QualitySetReport,
} from './runner.ts';
import type { QualityMetric, SetMetrics } from './types.ts';

const pct = (v: number | null): string => (v === null ? 'n/a' : (v * 100).toFixed(1));

function table(title: string, m: SetMetrics): string[] {
  return [
    `## ${title}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Queries | ${String(m.queries)} |`,
    `| nDCG@10 | ${pct(m.ndcg10)} |`,
    `| recall@50 | ${pct(m.recall50)} |`,
    `| Quote faithfulness | ${pct(m.quoteFaithfulness)} |`,
    `| Citation faithfulness | ${pct(m.citationFaithfulness)} |`,
    '',
  ];
}

export function renderJson(report: EvalReport, comparison: Comparison | null): string {
  return `${JSON.stringify({ ...report, comparison }, null, 2)}\n`;
}

export function renderMarkdown(report: EvalReport, comparison: Comparison | null): string {
  const lines = [`# Research retrieval eval (${report.ranker})`, ''];
  if (comparison !== null) {
    lines.push(
      `Baseline nDCG@10 ${pct(comparison.baselineNdcg10)}, now ${pct(comparison.ndcg10)}: ` +
        `${comparison.regressed ? 'REGRESSION (more than 2 points)' : 'within tolerance'}.`,
      '',
    );
  }
  lines.push(...table('Synthetic set', report.synthetic));
  if (report.private !== null) lines.push(...table('Private set (not gated)', report.private));
  lines.push(
    '## Per query (synthetic)',
    '',
    '| Query | nDCG@10 | recall@50 |',
    '| --- | --- | --- |',
  );
  for (const q of report.synthetic.perQuery) {
    lines.push(`| ${q.id} | ${pct(q.ndcg10)} | ${pct(q.recall50)} |`);
  }
  return `${lines.join('\n')}\n`;
}

// The copilot quality report (#1119): report.json (stable, versioned) and the Markdown summary.

const LABELS: Record<QualityMetric, string> = {
  recall50: 'recall@50',
  ndcg10: 'nDCG@10 (baseline)',
  ndcg10Hybrid: 'nDCG@10 (hybrid)',
  citationAccuracy: 'Citation accuracy',
  quoteVerificationRate: 'Quote verification rate',
  pinpointAccuracy: 'Pinpoint accuracy',
  falseVerified: 'False-verified claims',
};

const show = (metric: QualityMetric, v: number | null): string =>
  v === null ? 'n/a' : metric === 'falseVerified' ? String(v) : pct(v);

function qualityTable(title: string, set: QualitySetReport): string[] {
  const lines = [`## ${title}`, '', '| Metric | Value |', '| --- | --- |'];
  for (const metric of Object.keys(LABELS) as QualityMetric[]) {
    lines.push(`| ${LABELS[metric]} | ${show(metric, set.metrics[metric])} |`);
  }
  lines.push(
    `| Queries | ${String(set.perQuery.length)} |`,
    `| Answer cases / claims | ${set.answers === null ? 'n/a' : `${String(set.answers.cases)} / ${String(set.answers.claims)}`} |`,
    '',
  );
  return lines;
}

export function renderQualityJson(
  report: QualityReport,
  comparisons: MetricComparison[],
  failures: string[],
): string {
  const { schemaVersion, ...rest } = report;
  return `${JSON.stringify({ schemaVersion, passed: failures.length === 0, failures, comparisons, ...rest }, null, 2)}\n`;
}

export function renderQualityMarkdown(
  report: QualityReport,
  comparisons: MetricComparison[],
  failures: string[],
): string {
  const lines = [
    `# Copilot quality (${report.rankers.baseline}, ${report.rankers.hybrid})`,
    '',
    failures.length === 0 ? 'Gate: **passed**.' : 'Gate: **FAILED**.',
    '',
    ...failures.map((f) => `- ${f}`),
    ...(failures.length === 0 ? [] : ['']),
    ...qualityTable('Synthetic set (gated)', report.synthetic),
  ];
  if (report.private !== null) lines.push(...qualityTable('Private set (not gated)', report.private));
  lines.push(
    '## Against the baseline (synthetic)',
    '',
    '| Metric | Baseline | Now | Tolerance | Result |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const c of comparisons) {
    lines.push(
      `| ${LABELS[c.metric]} | ${show(c.metric, c.baseline)} | ${show(c.metric, c.current)} | ` +
        `${c.metric === 'falseVerified' ? 'must be 0' : show(c.metric, c.tolerance)} | ${c.regressed ? 'REGRESSION' : 'ok'} |`,
    );
  }
  lines.push('');
  const mismatches = report.synthetic.answers?.mismatches ?? [];
  if (mismatches.length > 0) {
    lines.push('## Answer mismatches (synthetic)', '', '| Case | Claim | Expected | Actual |', '| --- | --- | --- | --- |');
    for (const m of mismatches) {
      lines.push(`| ${m.caseId} | ${String(m.claimIndex)} | ${m.expected} | ${m.actual} |`);
    }
    lines.push('');
  }
  lines.push('## Per query (synthetic)', '', '| Query | nDCG@10 | nDCG@10 hybrid | recall@50 |', '| --- | --- | --- | --- |');
  for (const q of report.synthetic.perQuery) {
    lines.push(`| ${q.id} | ${pct(q.ndcg10)} | ${pct(q.ndcg10Hybrid)} | ${pct(q.recall50)} |`);
  }
  return `${lines.join('\n')}\n`;
}
