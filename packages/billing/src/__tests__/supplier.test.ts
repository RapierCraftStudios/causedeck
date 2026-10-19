import { describe, expect, it } from 'vitest';

import {
  resolveSupplier,
  SupplierNotConfiguredError,
  supplierFromEnv,
  TEST_SUPPLIER_GSTIN,
} from '../config/supplier';
import { InvalidGstinError, isValidGstin } from '../gstin';
import { issueInvoice } from '../invoice/generate';

import { createMemoryInvoiceStore } from './invoice-memory-store';

const CONFIGURED = {
  legalName: 'CauseDeck Technologies Pvt Ltd',
  address: '1 MG Road, Bengaluru 560001',
  gstin: '29aagcb7383j1z4',
};

describe('supplier config', () => {
  it('uses the configured supplier, with the state from its GSTIN', () => {
    expect(resolveSupplier(CONFIGURED, { nodeEnv: 'production' })).toEqual({
      legalName: 'CauseDeck Technologies Pvt Ltd',
      address: '1 MG Road, Bengaluru 560001',
      gstin: '29AAGCB7383J1Z4',
      stateCode: '29',
      series: 'CD',
      sac: '998314',
      isTest: false,
    });
    expect(
      resolveSupplier({ ...CONFIGURED, series: 'CDX', sac: '998315' }, { nodeEnv: 'production' }),
    ).toMatchObject({ series: 'CDX', sac: '998315' });
  });

  it.each([
    [{ ...CONFIGURED, legalName: undefined }, ['BILLING_SUPPLIER_LEGAL_NAME']],
    [{ ...CONFIGURED, gstin: '  ' }, ['BILLING_SUPPLIER_GSTIN']],
    [{}, ['BILLING_SUPPLIER_LEGAL_NAME', 'BILLING_SUPPLIER_GSTIN']],
  ])('refuses in production when the legal name or GSTIN is unset (%#)', (source, missing) => {
    let error: unknown;
    try {
      resolveSupplier(source, { nodeEnv: 'production' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SupplierNotConfiguredError);
    expect(error).toMatchObject({ code: 'SUPPLIER_NOT_CONFIGURED', missing });
    const message = (error as Error).message;
    expect(message).toMatch(/^Invoices cannot be issued: the supplier is not configured\./);
    for (const key of missing) expect(message).toContain(key);
  });

  it('uses a clearly labelled TEST supplier outside production', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      const supplier = resolveSupplier({}, { nodeEnv });
      expect(supplier.isTest).toBe(true);
      expect(supplier.legalName).toContain('TEST SUPPLIER');
      expect(supplier.legalName).toContain('NOT A VALID TAX INVOICE');
      expect(supplier.gstin).toBe(TEST_SUPPLIER_GSTIN);
      expect(supplier.stateCode).toBe('27');
    }
    expect(isValidGstin(TEST_SUPPLIER_GSTIN)).toBe(true);
  });

  it('rejects an invalid GSTIN, series or SAC', () => {
    expect(() =>
      resolveSupplier({ ...CONFIGURED, gstin: '29AAGCB7383J1Z5' }, { nodeEnv: 'production' }),
    ).toThrow(InvalidGstinError);
    expect(() =>
      resolveSupplier({ ...CONFIGURED, gstin: '29AAGCB7383J1Z5' }, { nodeEnv: 'development' }),
    ).toThrow(InvalidGstinError);
    expect(() =>
      resolveSupplier({ ...CONFIGURED, series: 'CD1' }, { nodeEnv: 'production' }),
    ).toThrow(RangeError);
    expect(() => resolveSupplier({ ...CONFIGURED, sac: '12' }, { nodeEnv: 'production' })).toThrow(
      RangeError,
    );
  });

  it('reads the BILLING_* env keys', () => {
    expect(
      supplierFromEnv({
        NODE_ENV: 'production',
        BILLING_SUPPLIER_LEGAL_NAME: CONFIGURED.legalName,
        BILLING_SUPPLIER_ADDRESS: CONFIGURED.address,
        BILLING_SUPPLIER_GSTIN: CONFIGURED.gstin,
        BILLING_INVOICE_SERIES: 'CD',
        BILLING_SAC: '998314',
      }),
    ).toMatchObject({ legalName: CONFIGURED.legalName, gstin: '29AAGCB7383J1Z4', isTest: false });
    expect(() => supplierFromEnv({ NODE_ENV: 'production' })).toThrow(SupplierNotConfiguredError);
  });

  it('makes issueInvoice refuse in production before anything is numbered or written', async () => {
    const store = createMemoryInvoiceStore();
    store.recipients.set('sub-1', { name: 'Sharma Chambers', gstin: null });
    await expect(
      issueInvoice(
        { store, supplier: () => supplierFromEnv({ NODE_ENV: 'production' }) },
        {
          subscriptionId: 'sub-1',
          periodStart: '2026-04-01',
          periodEnd: '2026-04-30',
          lines: [{ description: 'Advocate plan', quantity: 1, unitPricePaise: 49_900 }],
        },
      ),
    ).rejects.toMatchObject({ code: 'SUPPLIER_NOT_CONFIGURED' });
    expect(store.calls).toEqual([]);
    expect(store.invoices).toEqual([]);
  });
});
