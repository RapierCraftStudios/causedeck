import { describe, expect, it } from 'vitest';

import { clientBalance, recordExpense, recordReceipt } from '../fees/ledger';

const person = '00000000-0000-4000-8000-000000000002';

describe('fee ledger', () => {
  it('records an expense as a debit and a receipt as a credit', () => {
    const expense = recordExpense({
      personId: person,
      amountPaise: 50_000,
      description: 'Court fee',
      occurredOn: '2026-04-01',
    });
    const receipt = recordReceipt({
      personId: person,
      amountPaise: 20_000,
      reference: 'UPI 1',
      receivedOn: '2026-04-02',
    });
    expect(expense).toMatchObject({ kind: 'disbursement', direction: 'debit' });
    expect(receipt).toMatchObject({
      kind: 'receipt',
      direction: 'credit',
      occurredOn: '2026-04-02',
    });
    expect(clientBalance([expense, receipt])).toBe(30_000);
  });
  it('shows a negative balance when the client is in credit', () => {
    const receipt = recordReceipt({ personId: person, amountPaise: 5, receivedOn: '2026-04-02' });
    expect(clientBalance([receipt])).toBe(-5);
    expect(clientBalance([])).toBe(0);
  });
  it('rejects a zero or fractional amount', () => {
    expect(() =>
      recordExpense({
        personId: person,
        amountPaise: 0,
        description: 'x',
        occurredOn: '2026-04-01',
      }),
    ).toThrow();
    expect(() =>
      recordReceipt({ personId: person, amountPaise: 1.5, receivedOn: '2026-04-01' }),
    ).toThrow();
  });
});
