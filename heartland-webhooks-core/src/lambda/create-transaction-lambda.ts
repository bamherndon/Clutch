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
import {
  HeartlandClientFactory,
  TenantRegistry,
} from '../tenancy/registry';
import { TenantResolver } from '../tenancy/resolver';
import { TenantDefinition } from '../tenancy/tenant';
import { createWebhookLambda } from './pipeline';

export interface TransactionLambdaOptions {
  /** Every Heartland instance this deployment serves. */
  tenants: TenantDefinition<TransactionHandler>[];
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
 * lives in the {@link TransactionHandler} each tenant supplies.
 *
 * @example
 * export const handler = createTransactionLambda({
 *   tenants: [
 *     {
 *       tenantId: 'bamherndon',
 *       baseUrl: 'https://bamherndon.retail.heartland.us',
 *       getToken: () => loadToken('bamherndon'),
 *       handler: new BamTransactionHandler({ groupMe }),
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

  const registry = new TenantRegistry<TransactionHandler>(options.tenants, {
    logger,
    clientFactory: options.clientFactory,
  });

  return createWebhookLambda({
    eventType: 'sales_transaction_completed',
    registry,
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
