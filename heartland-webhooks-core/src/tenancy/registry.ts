import {
  DefaultHeartlandApiClient,
  HeartlandApiClient,
} from '../clients/heartland-api-client';
import { Logger, NoopLogger } from '../logging/logger';
import {
  TenantContext,
  TenantDefinition,
  TenantId,
  UnknownTenantError,
} from './tenant';

/**
 * Lets tests and non-AWS callers supply their own client instead of the
 * built-in HTTP one.
 */
export type HeartlandClientFactory = (
  baseUrl: string,
  token: string,
  logger: Logger
) => HeartlandApiClient;

const defaultClientFactory: HeartlandClientFactory = (
  baseUrl,
  token,
  logger
) => new DefaultHeartlandApiClient(baseUrl, token, logger);

export interface TenantRegistryOptions {
  logger?: Logger;
  clientFactory?: HeartlandClientFactory;
}

/**
 * Holds every tenant a deployment serves and builds their per-tenant context
 * on demand.
 *
 * Contexts are memoized per tenant for the process lifetime, so a warm Lambda
 * loads each tenant's token exactly once no matter how many tenants it serves.
 * A failed token load is not cached, so a transient Secrets Manager error does
 * not poison the tenant until the next cold start.
 */
export class TenantRegistry<THandler> {
  private readonly tenants = new Map<TenantId, TenantDefinition<THandler>>();
  private readonly contexts = new Map<TenantId, Promise<TenantContext>>();
  private readonly logger: Logger;
  private readonly clientFactory: HeartlandClientFactory;

  constructor(
    definitions: TenantDefinition<THandler>[],
    options: TenantRegistryOptions = {}
  ) {
    this.logger = options.logger ?? new NoopLogger();
    this.clientFactory = options.clientFactory ?? defaultClientFactory;

    for (const definition of definitions) {
      if (this.tenants.has(definition.tenantId)) {
        throw new Error(`Duplicate tenantId "${definition.tenantId}"`);
      }
      this.tenants.set(definition.tenantId, definition);
    }
  }

  get tenantIds(): TenantId[] {
    return Array.from(this.tenants.keys());
  }

  get size(): number {
    return this.tenants.size;
  }

  has(tenantId: TenantId): boolean {
    return this.tenants.has(tenantId);
  }

  /**
   * The only tenant's id, when exactly one is registered.
   *
   * Single-tenant deployments use this to skip tenant resolution entirely.
   */
  get soleTenantId(): TenantId | undefined {
    return this.tenants.size === 1 ? this.tenantIds[0] : undefined;
  }

  /**
   * Resolve a tenant to its handler and context.
   *
   * @throws UnknownTenantError when `tenantId` is not registered.
   */
  async resolve(
    tenantId: TenantId | undefined
  ): Promise<{ handler: THandler; context: TenantContext }> {
    const definition = tenantId ? this.tenants.get(tenantId) : undefined;
    if (!definition) {
      throw new UnknownTenantError(tenantId, this.tenantIds);
    }

    return {
      handler: definition.handler,
      context: await this.contextFor(definition),
    };
  }

  private contextFor(
    definition: TenantDefinition<THandler>
  ): Promise<TenantContext> {
    const cached = this.contexts.get(definition.tenantId);
    if (cached) {
      return cached;
    }

    const logger = this.logger.child(definition.tenantId);
    const pending = definition
      .getToken()
      .then((token) => {
        if (!token) {
          throw new Error(
            `Tenant "${definition.tenantId}" resolved an empty Heartland token`
          );
        }
        return {
          tenantId: definition.tenantId,
          baseUrl: definition.baseUrl,
          heartland: this.clientFactory(definition.baseUrl, token, logger),
          logger,
        };
      })
      .catch((err) => {
        // Do not cache failures: retry on the next invocation.
        this.contexts.delete(definition.tenantId);
        throw err;
      });

    this.contexts.set(definition.tenantId, pending);
    return pending;
  }
}
