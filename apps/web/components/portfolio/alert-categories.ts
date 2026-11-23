// Portfolio alert categories, in a plain module so server pages can use the values. Exported from
// the `'use client'` portfolio view they reached the server as client references, not arrays, and
// `/portfolio` failed with "PORTFOLIO_ALERT_CATEGORIES.includes is not a function".
export const PORTFOLIO_ALERT_CATEGORIES = [
  'portfolio.adverse_order',
  'portfolio.missed_date',
] as const;
export type PortfolioAlertCategory = (typeof PORTFOLIO_ALERT_CATEGORIES)[number];
