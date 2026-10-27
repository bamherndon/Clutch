import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { TransactionHandler } from '../handlers/handler';
import { ConsoleLogger, Logger } from '../logging/logger';
import {
  classifyTransaction,
  summarizeTransaction,
} from '../model/transaction';
import { parseTransactionBody } from '../parsing/transaction-parser';
import { HeartlandClientFactory, TenantRegistry } from '../tenancy/registry';
import { TenantResolver } from '../tenancy/resolver';
import { TenantConfig } from '../tenancy/tenant';
import { createWebhookLambda } from './pipeline';

export interface TransactionLambdaOptions {
  /**
   * The business logic, shared across every tenant. It receives a
   * `TenantContext` per invocation and must hold no per-tenant state.
   */
  handler: TransactionHandler;
  /** Every Heartland instance this deployment serves. */
  tenants: TenantConfig[];
  /**
   * How to attribute a request to a tenant. Required when more than one tenant
   * is registered; defaults to the sole tenant otherwise.
   */
  resolveTenant?: TenantResolver;
  logger?: Logger;
  clientFactory?: HeartlandClientFactory;
}

/**
 * Build the Lambda entrypoint for Heartland `sales_transaction_completed`
 * webhooks.
 *
 * Core owns the transport: envelope logging, tenant resolution, JSON parsing,
 * per-tenant client construction, and error containment. All business logic
 * lives in the single multi-tenant {@link TransactionHandler}.
 *
 * @example
 * export const handler = createTransactionLambda({
 *   handler: new InventoryCheckHandler({ groupMe }),
 *   tenants: [
 *     {
 *       tenantId: 'bamherndon',
 *       baseUrl: 'https://bamherndon.retail.heartland.us',
 *       getToken: () => loadToken('bamherndon'),
 *     },
 *     {
 *       tenantId: 'otherstore',
 *       baseUrl: 'https://otherstore.retail.heartland.us',
 *       getToken: () => loadToken('otherstore'),
 *     },
 *   ],
 *   resolveTenant: fromPathSegment(0),
 * });
 */
export function createTransactionLambda(
  options: TransactionLambdaOptions
): (
  event: APIGatewayProxyEventV2
) => Promise<APIGatewayProxyStructuredResultV2> {
  const logger = options.logger ?? new ConsoleLogger(['clutch']);

  return createWebhookLambda({
    eventType: 'sales_transaction_completed',
    handler: options.handler,
    registry: new TenantRegistry(options.tenants, {
      logger,
      clientFactory: options.clientFactory,
    }),
    resolveTenant: options.resolveTenant,
    logger,
    parse: parseTransactionBody,
    describe: (tx) => {
      const kind = classifyTransaction(tx);
      return {
        transactionId: tx.id,
        transactionType: tx.type,
        transactionKind: kind,
        transaction: summarizeTransaction(tx, kind),
      };
    },
    handlerName: (handler) => handler.name,
    supports: (handler, tx) =>
      handler.supports ? handler.supports(tx, classifyTransaction(tx)) : true,
    invoke: (handler, tx, context) => handler.handleTransaction(tx, context),
  });
}
