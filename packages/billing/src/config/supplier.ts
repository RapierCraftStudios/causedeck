// The supplier on SaaS invoices (#253, #29): CauseDeck's legal entity, read from env
// (`BILLING_SUPPLIER_*`, `BILLING_INVOICE_SERIES`, `BILLING_SAC`). The real legal name, address and
// GSTIN are a human deliverable (needs-human, #29), so the keys are optional and production still
// boots without them; issuing an invoice is what refuses, with `SupplierNotConfiguredError`. Outside
// production a missing supplier falls back to a clearly labelled TEST supplier.
//
// Server-only (reads the server env), so it is a subpath export and not in the package barrel.
import { serverEnv } from '@causedeck/config/env';

import { InvalidGstinError, normalizeGstin } from '../gstin';
import { resolveSac } from '../gst/sac';
import { stateCodeFromGstin } from '../gst/state-codes';
import { isInvoiceSeries } from '../invoice/numbering';

export const DEFAULT_INVOICE_SERIES = 'CD';

/** The env key behind each supplier field. */
export const SUPPLIER_ENV_KEYS = {
  legalName: 'BILLING_SUPPLIER_LEGAL_NAME',
  address: 'BILLING_SUPPLIER_ADDRESS',
  gstin: 'BILLING_SUPPLIER_GSTIN',
  series: 'BILLING_INVOICE_SERIES',
  sac: 'BILLING_SAC',
} as const;

export interface SupplierConfig {
  legalName: string;
  address: string;
  gstin: string;
  /** From the GSTIN. */
  stateCode: string;
  /** Invoice number series, e.g. `CD`. */
  series: string;
  sac: string;
  /** True for the development TEST supplier: never a valid tax invoice. */
  isTest: boolean;
}

export interface SupplierSource {
  legalName?: string | undefined;
  address?: string | undefined;
  gstin?: string | undefined;
  series?: string | undefined;
  sac?: string | undefined;
}

export interface SupplierOptions {
  nodeEnv: string | undefined;
}

export class SupplierNotConfiguredError extends Error {
  readonly code = 'SUPPLIER_NOT_CONFIGURED';
  /** The env keys that must be set. */
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Invoices cannot be issued: the supplier is not configured. Set ${missing.join(' and ')} ` +
        'to the registered legal entity before issuing invoices in production.',
    );
    this.name = 'SupplierNotConfiguredError';
    this.missing = missing;
  }
}

/** A checksum-valid GSTIN in Maharashtra that belongs to no one. */
export const TEST_SUPPLIER_GSTIN = '27AAAAA0000A1Z2';

export const TEST_SUPPLIER_LEGAL_NAME = 'TEST SUPPLIER - NOT A VALID TAX INVOICE';

const blank = (value: string | undefined) => (value ?? '').trim();

function seriesOf(source: SupplierSource): string {
  const series = blank(source.series) || DEFAULT_INVOICE_SERIES;
  if (!isInvoiceSeries(series)) {
    throw new RangeError(
      `${SUPPLIER_ENV_KEYS.series} must be 1-3 capital letters, got ${JSON.stringify(series)}`,
    );
  }
  return series;
}

/**
 * The supplier for an invoice. In production a missing legal name or GSTIN throws
 * `SupplierNotConfiguredError`; elsewhere it yields the TEST supplier. An invalid GSTIN throws
 * `InvalidGstinError` everywhere.
 */
export function resolveSupplier(
  source: SupplierSource,
  { nodeEnv }: SupplierOptions,
): SupplierConfig {
  const legalName = blank(source.legalName);
  const rawGstin = blank(source.gstin);
  const series = seriesOf(source);
  const sac = resolveSac(source.sac);

  if (legalName === '' || rawGstin === '') {
    if (nodeEnv === 'production') {
      const missing = [
        ...(legalName === '' ? [SUPPLIER_ENV_KEYS.legalName] : []),
        ...(rawGstin === '' ? [SUPPLIER_ENV_KEYS.gstin] : []),
      ];
      throw new SupplierNotConfiguredError(missing);
    }
    return {
      legalName: TEST_SUPPLIER_LEGAL_NAME,
      address: 'TEST ADDRESS - development only, Mumbai, Maharashtra',
      gstin: TEST_SUPPLIER_GSTIN,
      stateCode: stateCodeFromGstin(TEST_SUPPLIER_GSTIN),
      series,
      sac,
      isTest: true,
    };
  }

  const gstin = normalizeGstin(rawGstin);
  if (gstin === null) throw new InvalidGstinError();
  return {
    legalName,
    address: blank(source.address),
    gstin,
    stateCode: stateCodeFromGstin(gstin),
    series,
    sac,
    isTest: false,
  };
}

/** The env subset `supplierFromEnv` reads. */
export interface SupplierEnv {
  NODE_ENV?: string | undefined;
  BILLING_SUPPLIER_LEGAL_NAME?: string | undefined;
  BILLING_SUPPLIER_ADDRESS?: string | undefined;
  BILLING_SUPPLIER_GSTIN?: string | undefined;
  BILLING_INVOICE_SERIES?: string | undefined;
  BILLING_SAC?: string | undefined;
}

/** `resolveSupplier` over the validated server env. */
export function supplierFromEnv(env: SupplierEnv = serverEnv()): SupplierConfig {
  return resolveSupplier(
    {
      legalName: env.BILLING_SUPPLIER_LEGAL_NAME,
      address: env.BILLING_SUPPLIER_ADDRESS,
      gstin: env.BILLING_SUPPLIER_GSTIN,
      series: env.BILLING_INVOICE_SERIES,
      sac: env.BILLING_SAC,
    },
    { nodeEnv: env.NODE_ENV },
  );
}
