import { getNumber, getString, isRecord } from '../parsing/json';
import { ParseResult, parseError, parseOk } from '../parsing/result';
import {
  QUEUE_SCHEMA_VERSION,
  QueueEventType,
  QueueMessage,
} from './types';

const KNOWN_EVENT_TYPES: QueueEventType[] = [
  'sales_transaction_completed',
  'item_created',
];

/**
 * Read a queue message the receiver wrote, rejecting anything this build does
 * not understand.
 *
 * The version check is the point. Receiver and dispatcher deploy
 * independently, so a dispatcher will at some point be handed a message from a
 * newer receiver; it must say so rather than read the fields it recognizes and
 * guess at the rest.
 *
 * Returns a {@link ParseResult} rather than throwing, as every parser in core
 * does (`design/adr/0006-parse-results-not-exceptions.md`) — but note what the
 * caller should do with a failure here is the opposite of the webhook case. A
 * malformed envelope is a poison message: it will never parse, so the
 * dispatcher must fail it on the first attempt instead of letting redelivery
 * retry it.
 */
export function parseQueueMessage(value: unknown): ParseResult<QueueMessage> {
  if (!isRecord(value)) {
    return parseError('message is not a JSON object');
  }

  const schemaVersion = getNumber(value, 'schemaVersion');
  if (schemaVersion !== QUEUE_SCHEMA_VERSION) {
    return parseError(
      `unsupported schemaVersion ${JSON.stringify(value.schemaVersion)}; ` +
        `this build reads ${QUEUE_SCHEMA_VERSION}`
    );
  }

  const eventType = getString(value, 'eventType');
  if (!eventType || !isKnownEventType(eventType)) {
    return parseError(
      `unknown eventType ${JSON.stringify(value.eventType)}; ` +
        `known event types: ${KNOWN_EVENT_TYPES.join(', ')}`
    );
  }

  const tenantId = getString(value, 'tenantId');
  if (!tenantId) {
    return parseError('tenantId is missing');
  }

  const recordId = getNumber(value, 'recordId');
  if (recordId === undefined) {
    return parseError('recordId is missing or not a number');
  }

  if (!('record' in value)) {
    return parseError('record is missing');
  }

  const receivedAt = getString(value, 'receivedAt');
  if (!receivedAt) {
    return parseError('receivedAt is missing or not a string');
  }

  const fetchedAt = getString(value, 'fetchedAt');
  if (!fetchedAt) {
    return parseError('fetchedAt is missing or not a string');
  }

  // Taken verbatim rather than recomputed: the producer owns the key, and a
  // reader that rebuilt it would silently disagree with the queue it is
  // deduplicating against.
  const idempotencyKey = getString(value, 'idempotencyKey');
  if (!idempotencyKey) {
    return parseError('idempotencyKey is missing or not a string');
  }

  return parseOk({
    schemaVersion: QUEUE_SCHEMA_VERSION,
    eventType,
    tenantId,
    recordId,
    record: value.record,
    receivedAt,
    fetchedAt,
    idempotencyKey,
  });
}

function isKnownEventType(eventType: string): eventType is QueueEventType {
  return (KNOWN_EVENT_TYPES as string[]).includes(eventType);
}
