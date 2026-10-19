// The SAC (services accounting code) printed on SaaS invoices (#253, #29). The default is 998314
// (IT design and development services); it needs CA confirmation before real invoices are issued,
// so it is configurable through `BILLING_SAC`.

/** Default SAC. Needs CA confirmation (docs/engineering/billing.md). */
export const DEFAULT_SAC = '998314';

/** Service codes are six digits in chapter 99. */
export const SAC_PATTERN = /^99[0-9]{4}$/;

export function isValidSac(value: string): boolean {
  return SAC_PATTERN.test(value);
}

/** The configured SAC, or `DEFAULT_SAC` when none is configured. Throws on an invalid code. */
export function resolveSac(configured?: string | null): string {
  const sac = (configured ?? '').trim();
  if (sac === '') return DEFAULT_SAC;
  if (!isValidSac(sac)) throw new RangeError(`Invalid SAC ${JSON.stringify(sac)}: expected 99xxxx`);
  return sac;
}
