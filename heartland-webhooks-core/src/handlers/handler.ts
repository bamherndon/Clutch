import { HeartlandItemCreatedPayload } from '../model/item';
import { HeartlandTransaction, TransactionKind } from '../model/transaction';
import { TenantContext } from '../tenancy/tenant';

/**
 * What a business-logic plugin reports back about one webhook.
 *
 * `details` is opaque to core and echoed into the webhook response body, which
 * is how a plugin surfaces its own domain results (check summaries, actions
 * taken) without core having to model them.
 */
export interface WebhookOutcome {
  ok: boolean;
  details?: Record<string, unknown>;
}

/**
 * Business logic for `sales_transaction_completed` events.
 *
 * Implementations receive an already-parsed transaction and a tenant context;
 * they must not read tenant configuration from `process.env`.
 *
 * Returning nothing is equivalent to `{ ok: true }`. Throwing is reported as a
 * failed outcome and logged — it does not fail the HTTP response, because
 * Heartland disables webhook endpoints that keep erroring.
 */
export interface TransactionHandler {
  /** Identifies the plugin in logs and in the response body. */
  readonly name: string;

  /**
   * Optional filter. Returning false skips {@link handleTransaction} and
   * reports the webhook as ignored.
   */
  supports?(tx: HeartlandTransaction, kind: TransactionKind): boolean;

  handleTransaction(
    tx: HeartlandTransaction,
    context: TenantContext
  ): Promise<WebhookOutcome | void>;
}

/**
 * Business logic for `item_created` events. Same contract as
 * {@link TransactionHandler}.
 */
export interface ItemHandler {
  readonly name: string;

  supports?(item: HeartlandItemCreatedPayload): boolean;

  handleItemCreated(
    item: HeartlandItemCreatedPayload,
    context: TenantContext
  ): Promise<WebhookOutcome | void>;
}

/**
 * Normalize a plugin's return value, treating `void` as success.
 */
export function toOutcome(value: WebhookOutcome | void): WebhookOutcome {
  return value ?? { ok: true };
}
