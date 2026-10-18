// Allowed: the env module is the one place that reads process.env.
export const mode: string | undefined = process.env.NODE_ENV;
