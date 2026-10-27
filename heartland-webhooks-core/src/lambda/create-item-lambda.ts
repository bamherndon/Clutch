import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ItemHandler } from '../handlers/handler';
import { ConsoleLogger, Logger } from '../logging/logger';
import { parseItemCreatedBody } from '../parsing/item-parser';
import {
  HeartlandClientFactory,
  TenantRegistry,
} from '../tenancy/registry';
import { TenantResolver } from '../tenancy/resolver';
import { TenantDefinition } from '../tenancy/tenant';
import { createWebhookLambda } from './pipeline';

export interface ItemLambdaOptions {
  /** Every Heartland instance this deployment serves. */
  tenants: TenantDefinition<ItemHandler>[];
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
 * {@link ItemHandler} each tenant supplies decides what to do with the item
 * (image sourcing, tagging, enrichment).
 */
export function createItemLambda(
  options: ItemLambdaOptions
): (
  event: APIGatewayProxyEventV2
) => Promise<APIGatewayProxyStructuredResultV2> {
  const logger = options.logger ?? new ConsoleLogger(['clutch']);

  const registry = new TenantRegistry<ItemHandler>(options.tenants, {
    logger,
    clientFactory: options.clientFactory,
  });

  return createWebhookLambda({
    eventType: 'item_created',
    registry,
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
