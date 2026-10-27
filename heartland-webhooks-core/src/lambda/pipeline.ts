import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { WebhookOutcome, toOutcome } from '../handlers/handler';
import { Logger } from '../logging/logger';
import { ParseResult } from '../parsing/result';
import { TenantRegistry } from '../tenancy/registry';
import { TenantResolver } from '../tenancy/resolver';
import { TenantContext } from '../tenancy/tenant';
import { webhookResponse } from './response';

/**
 * Everything that differs between the transaction and item webhooks. The
 * surrounding plumbing — envelope logging, tenant resolution, parsing, error
 * containment, response shaping — is shared.
 *
 * The handler is a single multi-tenant instance, not one per tenant: it is
 * given a {@link TenantContext} on every invocation and takes everything
 * tenant-varying from there.
 */
export interface WebhookPipeline<TPayload, THandler> {
  eventType: string;
  handler: THandler;
  registry: TenantRegistry;
  resolveTenant?: TenantResolver;
  logger: Logger;
  parse(body: string): ParseResult<TPayload>;
  /** Fields describing the payload, merged into logs and the response body. */
  describe(payload: TPayload): Record<string, unknown>;
  supports(handler: THandler, payload: TPayload): boolean;
  handlerName(handler: THandler): string;
  invoke(
    handler: THandler,
    payload: TPayload,
    context: TenantContext
  ): Promise<WebhookOutcome | void>;
}

export function createWebhookLambda<TPayload, THandler>(
  pipeline: WebhookPipeline<TPayload, THandler>
): (
  event: APIGatewayProxyEventV2
) => Promise<APIGatewayProxyStructuredResultV2> {
  const { eventType, handler, registry, logger } = pipeline;

  if (registry.size === 0) {
    throw new Error(
      `createWebhookLambda(${eventType}): no tenants registered`
    );
  }
  if (!pipeline.resolveTenant && !registry.soleTenantId) {
    throw new Error(
      `createWebhookLambda(${eventType}): resolveTenant is required when more ` +
        `than one tenant is registered (${registry.tenantIds.join(', ')})`
    );
  }

  const log = logger.child(eventType);
  const handlerName = pipeline.handlerName(handler);

  return async (event) => {
    log.info('Received webhook', {
      rawPath: event.rawPath,
      headers: event.headers,
      requestContext: {
        http: event.requestContext?.http,
        timeEpoch: event.requestContext?.timeEpoch,
      },
    });

    const ignored = (reason: string, extra: Record<string, unknown> = {}) => {
      log.warn(`Ignoring webhook: ${reason}`, extra);
      return webhookResponse({
        status: 'ignored',
        eventType,
        ok: false,
        reason,
        ...extra,
      });
    };

    const failed = (reason: string, extra: Record<string, unknown> = {}) => {
      log.error(`Webhook failed: ${reason}`, extra);
      return webhookResponse({
        status: 'error',
        eventType,
        ok: false,
        reason,
        ...extra,
      });
    };

    if (!event.body) {
      return ignored('request has no body');
    }

    // Resolve the tenant before parsing: an unroutable request is a
    // configuration problem worth reporting on its own.
    const tenantId = pipeline.resolveTenant
      ? pipeline.resolveTenant(event)
      : registry.soleTenantId;

    if (!tenantId) {
      return failed('could not resolve a tenant from the request', {
        rawPath: event.rawPath,
        knownTenantIds: registry.tenantIds,
      });
    }
    if (!registry.has(tenantId)) {
      return failed(`unknown tenant "${tenantId}"`, {
        tenantId,
        knownTenantIds: registry.tenantIds,
      });
    }

    const parsed = pipeline.parse(event.body);
    if (!parsed.ok) {
      log.error('Unparseable body', event.body);
      return failed(`could not parse body: ${parsed.error}`, { tenantId });
    }

    const payload = parsed.value;
    const described = pipeline.describe(payload);

    if (!pipeline.supports(handler, payload)) {
      return ignored('handler does not support this event', {
        tenantId,
        handler: handlerName,
        ...described,
      });
    }

    let context: TenantContext;
    try {
      context = await registry.context(tenantId);
    } catch (err) {
      return failed(`tenant initialization failed: ${String(err)}`, {
        tenantId,
        ...described,
      });
    }

    context.logger.info('Handling webhook', described);

    let outcome: WebhookOutcome;
    try {
      outcome = toOutcome(await pipeline.invoke(handler, payload, context));
    } catch (err) {
      // Contain handler failures: report them in the body and logs, but still
      // answer 200 so Heartland keeps the endpoint enabled.
      context.logger.error('Handler threw', err);
      return failed(`handler threw: ${String(err)}`, {
        tenantId,
        handler: handlerName,
        ...described,
      });
    }

    context.logger.info(`Handled webhook (ok=${outcome.ok})`, outcome.details);

    return webhookResponse({
      status: outcome.ok ? 'ok' : 'error',
      eventType,
      ok: outcome.ok,
      tenantId,
      handler: handlerName,
      details: outcome.details,
      ...described,
    });
  };
}
