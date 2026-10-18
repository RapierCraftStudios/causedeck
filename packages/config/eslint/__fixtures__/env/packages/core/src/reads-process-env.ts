// Violation: only packages/config/src/env may read process.env.
export const mode: string | undefined = process.env.NODE_ENV;
