import {
  buildParkedTrigger,
  buildQueueMessage,
  idempotencyKeyFor,
  QueueMessageInput,
} from '../../src/publishing/build-queue-message';
import { QUEUE_SCHEMA_VERSION } from '../../src/publishing/types';

const receivedAt = new Date('2026-11-26T15:04:05.000Z');
const fetchedAt = new Date('2026-11-26T15:04:05.250Z');

function input(overrides: Partial<QueueMessageInput> = {}): QueueMessageInput {
  return {
    eventType: 'sales_transaction_completed',
    tenantId: 'bamherndon',
    recordId: 42,
    record: { id: 42, total: '19.99' },
    receivedAt,
    fetchedAt,
    ...overrides,
  };
}

describe('buildQueueMessage', () => {
  it('stamps the schema version and derives the idempotency key', () => {
    const message = buildQueueMessage(input());

    expect(message).toEqual({
      schemaVersion: QUEUE_SCHEMA_VERSION,
      eventType: 'sales_transaction_completed',
      tenantId: 'bamherndon',
      recordId: 42,
      record: { id: 42, total: '19.99' },
      receivedAt: '2026-11-26T15:04:05.000Z',
      fetchedAt: '2026-11-26T15:04:05.250Z',
      idempotencyKey: 'bamherndon:sales_transaction_completed:42',
    });
  });

  it('keys an item_created event on its own event type', () => {
    const message = buildQueueMessage(
      input({ eventType: 'item_created', recordId: 7 })
    );
    expect(message.idempotencyKey).toBe('bamherndon:item_created:7');
  });

  it('distinguishes tenants, so two stores never share a key', () => {
    const a = buildQueueMessage(input({ tenantId: 'bamherndon' }));
    const b = buildQueueMessage(input({ tenantId: 'bamsterling' }));
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it('passes the record through without reshaping it', () => {
    // Verbatim API output: snake_case survives, and so does a field core does
    // not model.
    const record = {
      id: 42,
      custom: { toyhouse_sku: 'TH-1' },
      field_core_has_never_heard_of: true,
    };
    expect(buildQueueMessage(input({ record })).record).toBe(record);
  });

  it('normalizes timestamps given as strings to canonical ISO 8601', () => {
    const message = buildQueueMessage(
      input({
        receivedAt: 'Thu, 26 Nov 2026 15:04:05 GMT',
        fetchedAt: '2026-11-26T15:04:05.250Z',
      })
    );

    expect(message.receivedAt).toBe('2026-11-26T15:04:05.000Z');
    expect(message.fetchedAt).toBe('2026-11-26T15:04:05.250Z');
  });

  it('rejects an unparseable timestamp, naming the field', () => {
    expect(() => buildQueueMessage(input({ receivedAt: 'yesterday' }))).toThrow(
      'receivedAt is not a valid timestamp: "yesterday"'
    );
    expect(() => buildQueueMessage(input({ fetchedAt: new Date(NaN) }))).toThrow(
      'fetchedAt is not a valid timestamp'
    );
  });

  it('rejects a record id that could not have come from a real record', () => {
    expect(() => buildQueueMessage(input({ recordId: 1.5 }))).toThrow(
      'recordId must be an integer; got 1.5'
    );
    expect(() => buildQueueMessage(input({ recordId: NaN }))).toThrow(
      'recordId must be an integer'
    );
  });

  it('rejects a blank tenant id rather than keying on an empty string', () => {
    expect(() => buildQueueMessage(input({ tenantId: '' }))).toThrow(
      'tenantId is required'
    );
  });
});

describe('buildParkedTrigger', () => {
  it('carries the trigger, the reason, and nothing from the body', () => {
    const trigger = buildParkedTrigger({
      eventType: 'item_created',
      tenantId: 'bamherndon',
      recordId: 7,
      reason: 'fetch failed after 2 attempts: 503',
      receivedAt,
    });

    expect(trigger).toEqual({
      schemaVersion: QUEUE_SCHEMA_VERSION,
      eventType: 'item_created',
      tenantId: 'bamherndon',
      recordId: 7,
      reason: 'fetch failed after 2 attempts: 503',
      receivedAt: '2026-11-26T15:04:05.000Z',
    });
  });

  it('omits recordId when the body could not be parsed far enough to find one', () => {
    const trigger = buildParkedTrigger({
      eventType: 'item_created',
      tenantId: 'bamherndon',
      reason: 'unparseable trigger',
      receivedAt,
    });

    expect('recordId' in trigger).toBe(false);
  });

  it('accepts an event type we do not handle, because parking precedes knowing', () => {
    const trigger = buildParkedTrigger({
      eventType: 'something_heartland_added_last_week',
      tenantId: 'bamherndon',
      reason: 'publish failed',
      receivedAt,
    });

    expect(trigger.eventType).toBe('something_heartland_added_last_week');
  });

  it('applies the same input checks as buildQueueMessage', () => {
    expect(() =>
      buildParkedTrigger({
        eventType: 'item_created',
        tenantId: '',
        reason: 'publish failed',
        receivedAt,
      })
    ).toThrow('tenantId is required');

    expect(() =>
      buildParkedTrigger({
        eventType: 'item_created',
        tenantId: 'bamherndon',
        recordId: 1.5,
        reason: 'publish failed',
        receivedAt,
      })
    ).toThrow('recordId must be an integer');
  });
});

describe('idempotencyKeyFor', () => {
  it('is the key a consumer can rebuild from the envelope fields', () => {
    const message = buildQueueMessage(input());
    expect(
      idempotencyKeyFor(message.tenantId, message.eventType, message.recordId)
    ).toBe(message.idempotencyKey);
  });
});
