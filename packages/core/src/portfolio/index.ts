// The portfolio domain (#663, part 3 of #498, D-048 B2B): an institution's tracked cases. An owner
// imports a CSV of CNRs or case numbers (max 1,000 rows), which stores the cases and creates
// delegated, staggered watches under the portfolio's panel advocates (never a fetch, never bulk
// captcha); members read dashboard queries and export the cases as CSV.
export {
  importPortfolioCases,
  MAX_PORTFOLIO_WATCHES_PER_ADVOCATE,
  PORTFOLIO_WATCH_CADENCE_MINUTES,
  type ImportPortfolioDeps,
  type ImportPortfolioInput,
  type ImportPortfolioReport,
} from './import.ts';
export {
  listPortfolioCases,
  portfolioSummary,
  type ListPortfolioCasesInput,
  type PortfolioCaseRow,
  type PortfolioSummary,
} from './dashboard.ts';
export { exportPortfolioCsv, PORTFOLIO_EXPORT_HEADER } from './export.ts';
export {
  MAX_PORTFOLIO_IMPORT_ROWS,
  parsePortfolioCsv,
  type ParsedPortfolioCsv,
  type PortfolioCsvError,
  type PortfolioCsvRow,
} from './csv.ts';
export {
  PORTFOLIO_ALERT_MAX_CASES,
  scanPortfolioAlerts,
  type PortfolioAlertDeps,
  type PortfolioAlertReport,
} from './alerts.ts';
