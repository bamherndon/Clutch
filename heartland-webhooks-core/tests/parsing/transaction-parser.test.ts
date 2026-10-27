import { parseTransactionBody } from '../../src/parsing/transaction-parser';
import {
  classifyTransaction,
  summarizeTransaction,
} from '../../src/model/transaction';

describe('parseTransactionBody', () => {
  it('parses a transaction and preserves unmodelled fields', () => {
    const result = parseTransactionBody(
      JSON.stringify({
        id: 42,
        type: 'Ticket',
        total: 19.99,
        'completed?': true,
        total_discounts: 3,
        some_future_field: 'kept',
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(42);
    expect(result.value['completed?']).toBe(true);
    expect(result.value.some_future_field).toBe('kept');
  });

  it('rejects invalid JSON', () => {
    const result = parseTransactionBody('{not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('invalid JSON');
  });

  it('rejects a non-object payload', () => {
    const result = parseTransactionBody('[1,2,3]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('payload is not an object');
  });

  it('rejects a payload without a numeric id', () => {
    const result = parseTransactionBody(JSON.stringify({ type: 'Ticket' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('payload is missing a numeric id');
  });
});

describe('classifyTransaction', () => {
  it('uses the explicit type when present', () => {
    expect(classifyTransaction({ id: 1, type: 'Ticket', total: -5 })).toBe(
      'sale'
    );
    expect(classifyTransaction({ id: 1, type: 'Return', total: 5 })).toBe(
      'return'
    );
  });

  it('falls back to the sign of total', () => {
    expect(classifyTransaction({ id: 1, type: 'Other', total: 5 })).toBe('sale');
    expect(classifyTransaction({ id: 1, type: 'Other', total: -5 })).toBe(
      'return'
    );
    expect(classifyTransaction({ id: 1, type: 'Other', total: 0 })).toBe(
      'other'
    );
  });
});

describe('summarizeTransaction', () => {
  it('includes the Heartland completed? flag under a safe key', () => {
    const summary = summarizeTransaction(
      { id: 7, type: 'Ticket', total: 1, 'completed?': false, balance: 0 },
      'sale'
    );
    expect(summary.completed_flag).toBe(false);
    expect(summary.kind).toBe('sale');
    expect(summary.id).toBe(7);
  });
});
