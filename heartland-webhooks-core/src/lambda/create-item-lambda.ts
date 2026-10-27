import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ItemHandler } from '../handlers/handler';
import { ConsoleLogger, Logger } from '../logging/logger';
import { parseItemCreatedBody } from '../parsing/item-parser';
import { HeartlandClientFactory, TenantRegistry } from '../tenancy/registry';
import { TenantResolver } from '../tenancy/resolver';
import { TenantConfig } from '../tenancy/tenant';
import { createWebhookLambda } from './pipeline';

export interface ItemLambdaOptions {
  /**
   * The business logic, shared across every tenant. It receives a
   * `TenantContext` per invocation and must hold no per-tenant state.
   */
  handler: ItemHandler;
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
 * Build the Lambda entrypoint for Heartland `item_created` webhooks.
 *
 * Core parses and normalizes the item payload and resolves the tenant; the
 * single multi-tenant {@link ItemHandler} decides what to do with the item
 * (image sourcing, tagging, enrichment).
 */
export function createItemLambda(
  options: ItemLambdaOptions
): (
  event: APIGatewayProxyEventV2
) => Promise<APIGatewayProxyStructuredResultV2> {
  const logger = options.logger ?? new ConsoleLogger(['clutch']);

  return createWebhookLambda({
    eventType: 'item_created',
    handler: options.handler,
    registry: new TenantRegistry(options.tenants, {
      logger,
      clientFactory: options.clientFactory,
    }),
    resolveTenant: options.resolveTenant,
    logger,
    parse: parseItemCreatedBody,
    describe: (item) => ({
      itemId: item.id,
      publicId: item.publicId,
      department: item.custom?.department,
      subDepartment: item.custom?.subDepartment,
    }),
    handlerName: (handler) => handler.name,
    supports: (handler, item) =>
      handler.supports ? handler.supports(item) : true,
    invoke: (handler, item, context) =>
      handler.handleItemCreated(item, context),
  });
}
