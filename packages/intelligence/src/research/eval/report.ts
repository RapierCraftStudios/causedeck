import type { Comparison, EvalReport } from './runner.ts';
import type { SetMetrics } from './types.ts';

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
