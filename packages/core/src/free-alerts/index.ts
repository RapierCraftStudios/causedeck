// The free court-day alerts tier (#506, growth): a free advocate gets listing and item alerts with
// no setup beyond discovery. `enrollFreeAlerts` watches the discovered cases up to the free tier's
// allowance; the poll guard (`createFreeAlertsPollGuard`) keeps each free workspace's delegated
// fetch spend under its monthly cap (`admitLookup`, `recordFetchCost`, the `fetch.cost_micros`
// usage key); upgrade prompts are one non-blocking line at natural moments. Dark behind
// `growth.free-alerts`. Not re-exported from the root.
export * from './budget.ts';
export * from './enroll.ts';
export * from './guard.ts';
export * from './upgrade.ts';
