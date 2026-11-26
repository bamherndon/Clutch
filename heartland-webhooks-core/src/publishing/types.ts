/**
 * The contract between the receiver and the dispatcher.
 *
 * These two run in separately deployed Lambdas with a queue between them
 * ([ADR-0007](../../../design/adr/0007-asynchronous-processing-with-dlqs.md)),
 * so this shape is the only thing they share at runtime — hence the version
 * field, and hence the publisher being an interface rather than an SQS call.
 */

/**
 * Version of {@link QueueMessage} and {@link ParkedTrigger} produced by this
 * package.
 *
 * Bump it when a consumer could misread an older or newer message, and leave
 * `parseQueueMessage` rejecting versions it does not know. Guessing at an
 * unknown version is how a partial deploy turns into silent data loss.
 */
export const QUEUE_SCHEMA_VERSION = 1;

/** Heartland event types that reach the queue today. */
export type QueueEventType = 'sales_transaction_completed' | 'item_created';

/**
 * One validated event on its way to a handler.
 *
 * `record` is the Heartland API's own representation, not the webhook body: the
 * body is an untrusted trigger and nothing downstream of the receiver ever sees
 * it ([ADR-0006](../../../design/adr/0006-webhook-is-a-trigger-api-is-truth.md)).
 */
export interface QueueMessage {
  schemaVersion: typeof QUEUE_SCHEMA_VERSION;
  eventType: QueueEventType;
  tenantId: string;
  recordId: number;
  /**
   * The API's representation of the record, `snake_case`, verbatim.
   *
   * Core does not reshape it — these objects round-trip back to Heartland on
   * updates, and translating in both directions invites field-name drift
   * (`design/04-conventions.md`).
   */
  record: unknown;
  /** ISO 8601 — when the trigger arrived. */
  receivedAt: string;
  /**
   * ISO 8601 — when the record was read.
   *
   * Kept alongside `receivedAt` because the two gaps answer different
   * questions: `receivedAt` → `fetchedAt` is receiver latency, and `fetchedAt`
   * → processing time is how stale the record may be when a handler acts.
   */
  fetchedAt: string;
  /**
   * `${tenantId}:${eventType}:${recordId}`.
   *
   * **Correct for today's two event types only.** A transaction id and an
   * `item_created` id each identify a one-time event, so collapsing duplicates
   * on this key is what we want. It would be *wrong* for a future
   * `item_updated`, where the same record changes repeatedly and this key would
   * collapse distinct updates into one. Adding such an event means revisiting
   * this field, not reusing it.
   */
  idempotencyKey: string;
}

/**
 * A trigger we could not turn into a queue message, on its way to the core DLQ.
 *
 * It deliberately **omits the raw webhook body.** Replay needs the id, and we
 * do not trust the body
 * ([ADR-0006](../../../design/adr/0006-webhook-is-a-trigger-api-is-truth.md));
 * the envelope log already holds what forensics needs. Carrying the body here
 * would put untrusted data into the one place a human goes to decide what to
 * re-run.
 */
export interface ParkedTrigger {
  schemaVersion: typeof QUEUE_SCHEMA_VERSION;
  /**
   * Not narrowed to {@link QueueEventType}: a trigger can be parked before we
   * have established that its event type is one we handle.
   */
  eventType: string;
  tenantId: string;
  /** Absent when the body could not be parsed far enough to find an id. */
  recordId?: number;
  /** Why it was parked — failed fetch, failed publish — in human terms. */
  reason: string;
  /** ISO 8601 — when the trigger arrived. */
  receivedAt: string;
}

/**
 * How the receiver gets an event onto the queue.
 *
 * Injected, exactly as `TenantConfig.getToken` is. Core does not import an AWS
 * SDK: the deployment module supplies the SQS-backed implementation and tests
 * supply `RecordingPublisher`. Without this seam, "receive a webhook and
 * enqueue" would be the change that put the SDK into core's `dependencies` and
 * its cold start (`design/adr/0004-zero-runtime-dependencies.md`).
 */
export interface EventPublisher {
  /** Put a validated record on the work queue. */
  publish(message: QueueMessage): Promise<void>;

  /**
   * Write a trigger to the **core DLQ**, to be replayed by re-fetching.
   *
   * Distinct from the handler DLQ, which holds records we read but could not
   * act on. The remedies differ, which is why the queues do.
   */
  park(trigger: ParkedTrigger): Promise<void>;
}
