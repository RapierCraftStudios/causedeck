// Presentation helpers for the memory page: rates as locale percentages, a proposal's value
// without its trailing sentence punctuation, and the chart's bar scale.
import { formatNumber } from '@causedeck/i18n';
import type { Locale } from '@causedeck/i18n/locales';

/** 0.053 -> "5.3%" (en-IN, ta-IN, kn-IN via Intl.NumberFormat); null -> an en dash. */
export function formatRate(value: number | null, locale: Locale): string {
  if (value === null) return '–';
  return formatNumber(value, { locale, style: 'percent', maximumFractionDigits: 1 });
}

/** "Put the date first." -> "Put the date first": the template adds its own closing mark. */
export function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s.!?;:,…।]+$/u, '');
}

/** Bar height as a percent of the chart. Scaled to the largest rate (floor 10%) so small rates show. */
export function barHeightPercent(rate: number | null, max: number): number {
  if (rate === null || rate <= 0) return 0;
  const scale = Math.max(max, 0.1);
  return Math.min(100, Math.round((rate / scale) * 100));
}
