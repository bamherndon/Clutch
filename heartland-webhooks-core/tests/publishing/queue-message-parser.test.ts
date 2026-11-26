import { buildQueueMessage } from '../../src/publishing/build-queue-message';
import { parseQueueMessage } from '../../src/publishing/queue-message-parser';

const valid = buildQueueMessage({
  eventType: 'sales_transaction_completed',
  tenantId: 'bamherndon',
  recordId: 42,
  record: { id: 42, total: '19.99' },
  receivedAt: new Date('2026-11-26T15:04:05.000Z'),
  fetchedAt: new Date('2026-11-26T15:04:05.250Z'),
});

function parseWith(overrides: Record<string, unknown>) {
  return parseQueueMessage({ ...valid, ...overrides });
}

function errorOf(result: ReturnType<typeof parseQueueMessage>): string {
  if (result.ok) {
    throw new Error('expected a parse failure');
  }
  return result.error;
}

describe('parseQueueMessage', () => {
  it('round-trips a message this build produced, through JSON', () => {
    const result = parseQueueMessage(JSON.parse(JSON.stringify(valid)));

    expect(result).toEqual({ ok: true, value: valid });
  });

  it('rejects a schema version it does not know rather than reading the fields it recognizes', () => {
    expect(errorOf(parseWith({ schemaVersion: 2 }))).toBe(
      'unsupported schemaVersion 2; this build reads 1'
    );
    expect(errorOf(parseWith({ schemaVersion: '1' }))).toContain(
      'unsupported schemaVersion "1"'
    );
    expect(errorOf(parseWith({ schemaVersion: undefined }))).toContain(
      'unsupported schemaVersion'
    );
  });

  it('rejects an unknown event type, listing the ones it knows', () => {
    const error = errorOf(parseWith({ eventType: 'item_updated' }));

    expect(error).toContain('unknown eventType "item_updated"');
    expect(error).toContain('sales_transaction_completed, item_created');
  });

  it('names the missing field', () => {
    expect(errorOf(parseWith({ tenantId: '' }))).toBe('tenantId is missing');
    expect(errorOf(parseWith({ recordId: '42' }))).toBe(
      'recordId is missing or not a number'
    );
    expect(errorOf(parseWith({ receivedAt: undefined }))).toBe(
      'receivedAt is missing or not a string'
    );
    expect(errorOf(parseWith({ fetchedAt: 0 }))).toBe(
      'fetchedAt is missing or not a string'
    );
    expect(errorOf(parseWith({ idempotencyKey: undefined }))).toBe(
      'idempotencyKey is missing or not a string'
    );
  });

  it('distinguishes a null record from an absent one', () => {
    // A record the API returned as null is still a record we read; the field
    // being gone means the producer never set it.
    expect(parseWith({ record: null }).ok).toBe(true);

    const withoutRecord: Record<string, unknown> = { ...valid };
    delete withoutRecord.record;
    expect(errorOf(parseQueueMessage(withoutRecord))).toBe(
      'record is missing'
    );
  });

  it('rejects anything that is not a JSON object', () => {
    expect(errorOf(parseQueueMessage(undefined))).toBe(
      'message is not a JSON object'
    );
    expect(errorOf(parseQueueMessage('{}'))).toBe(
      'message is not a JSON object'
    );
    expect(errorOf(parseQueueMessage([valid]))).toBe(
      'message is not a JSON object'
    );
  });

  it('takes the idempotency key verbatim instead of recomputing it', () => {
    const result = parseWith({ idempotencyKey: 'legacy-key' });

    expect(result.ok && result.value.idempotencyKey).toBe('legacy-key');
  });
});
