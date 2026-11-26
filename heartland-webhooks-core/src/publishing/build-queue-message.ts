import {
  ParkedTrigger,
  QUEUE_SCHEMA_VERSION,
  QueueEventType,
  QueueMessage,
} from './types';

/**
 * Everything the receiver knows that the dispatcher cannot derive.
 *
 * `schemaVersion` and `idempotencyKey` are deliberately absent: they are
 * derived, and deriving them in one place is the reason this builder exists
 * rather than object literals at each call site.
 */
export interface QueueMessageInput {
  eventType: QueueEventType;
  tenantId: string;
  recordId: number;
  /** The API's representation of the record, passed through untouched. */
  record: unknown;
  receivedAt: Date | string;
  fetchedAt: Date | string;
}

/** The fields of a parked trigger that are not derived. */
export interface ParkedTriggerInput {
  eventType: string;
  tenantId: string;
  recordId?: number;
  reason: string;
  receivedAt: Date | string;
}

/**
 * The key duplicate deliveries collapse on.
 *
 * Read the warning on {@link QueueMessage.idempotencyKey} before reusing this
 * for a new event type.
 */
export function idempotencyKeyFor(
  tenantId: string,
  eventType: string,
  recordId: number
): string {
  return `${tenantId}:${eventType}:${recordId}`;
}

/**
 * Build the versioned message the dispatcher will read.
 *
 * Throws on an input that could not have come from a successful fetch — an
 * unparseable timestamp, a non-integer record id, a blank tenant. Those are
 * programming errors in the receiver, not the routine malformed-webhook case
 * `ParseResult` exists for, and they are cheapest to find at the call site that
 * made them rather than in a dispatcher log a queue hop away.
 */
export function buildQueueMessage(input: QueueMessageInput): QueueMessage {
  const tenantId = requireTenantId(input.tenantId);
  const recordId = requireRecordId(input.recordId);

  return {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    eventType: input.eventType,
    tenantId,
    recordId,
    record: input.record,
    receivedAt: isoTimestamp(input.receivedAt, 'receivedAt'),
    fetchedAt: isoTimestamp(input.fetchedAt, 'fetchedAt'),
    idempotencyKey: idempotencyKeyFor(tenantId, input.eventType, recordId),
  };
}

/**
 * Build the trigger written to the core DLQ.
 *
 * Shares the schema version with {@link buildQueueMessage} so the receiver
 * never writes the literal itself. `recordId` stays optional here: a body that
 * could not be parsed has no id, and parking it anyway is better than dropping
 * it.
 */
export function buildParkedTrigger(input: ParkedTriggerInput): ParkedTrigger {
  const trigger: ParkedTrigger = {
    schemaVersion: QUEUE_SCHEMA_VERSION,
    eventType: input.eventType,
    tenantId: requireTenantId(input.tenantId),
    reason: input.reason,
    receivedAt: isoTimestamp(input.receivedAt, 'receivedAt'),
  };

  if (input.recordId !== undefined) {
    trigger.recordId = requireRecordId(input.recordId);
  }

  return trigger;
}

function requireTenantId(tenantId: string): string {
  if (!tenantId) {
    return fail('tenantId is required');
  }
  return tenantId;
}

function requireRecordId(recordId: number): number {
  if (!Number.isInteger(recordId)) {
    return fail(
      `recordId must be an integer; got ${JSON.stringify(recordId)}`
    );
  }
  return recordId;
}

/**
 * Normalize to a canonical ISO 8601 string, so a caller holding a `Date` and
 * one holding a timestamp from an HTTP header produce the same field.
 */
function isoTimestamp(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fail(`${field} is not a valid timestamp: ${JSON.stringify(value)}`);
  }
  return date.toISOString();
}

function fail(reason: string): never {
  throw new TypeError(`Invalid publishing input: ${reason}`);
}
