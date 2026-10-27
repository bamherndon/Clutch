import {
  DefaultHeartlandApiClient,
  HeartlandApiClient,
} from '../clients/heartland-api-client';
import { Logger, NoopLogger } from '../logging/logger';
import {
  TenantConfig,
  TenantContext,
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
export class TenantRegistry {
  private readonly tenants = new Map<TenantId, TenantConfig>();
  private readonly contexts = new Map<TenantId, Promise<TenantContext>>();
  private readonly logger: Logger;
  private readonly clientFactory: HeartlandClientFactory;

  constructor(tenants: TenantConfig[], options: TenantRegistryOptions = {}) {
    this.logger = options.logger ?? new NoopLogger();
    this.clientFactory = options.clientFactory ?? defaultClientFactory;

    for (const tenant of tenants) {
      if (this.tenants.has(tenant.tenantId)) {
        throw new Error(`Duplicate tenantId "${tenant.tenantId}"`);
      }
      this.tenants.set(tenant.tenantId, tenant);
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
   * Build (or return the cached) context for a tenant.
   *
   * @throws UnknownTenantError when `tenantId` is not registered.
   */
  context(tenantId: TenantId | undefined): Promise<TenantContext> {
    const tenant = tenantId ? this.tenants.get(tenantId) : undefined;
    if (!tenant) {
      return Promise.reject(
        new UnknownTenantError(tenantId, this.tenantIds)
      );
    }

    const cached = this.contexts.get(tenant.tenantId);
    if (cached) {
      return cached;
    }

    const logger = this.logger.child(tenant.tenantId);
    const pending = this.buildContext(tenant, logger).catch(
      (err: unknown) => {
        // Do not cache failures: retry on the next invocation.
        this.contexts.delete(tenant.tenantId);
        throw err;
      }
    );

    this.contexts.set(tenant.tenantId, pending);
    return pending;
  }

  private async buildContext(
    tenant: TenantConfig,
    logger: Logger
  ): Promise<TenantContext> {
    // Note the client is assigned, never awaited: `unavailableClient` is a
    // Proxy, and awaiting a Proxy would consult it for `then`.
    const heartland = tenant.getToken
      ? this.clientFactory(
          tenant.baseUrl,
          await this.loadToken(tenant),
          logger
        )
      : unavailableClient(tenant.tenantId);

    return {
      tenantId: tenant.tenantId,
      baseUrl: tenant.baseUrl,
      heartland,
      logger,
    };
  }

  private async loadToken(tenant: TenantConfig): Promise<string> {
    const token = await tenant.getToken?.();
    if (!token) {
      throw new Error(
        `Tenant "${tenant.tenantId}" resolved an empty Heartland token`
      );
    }
    return token;
  }
}

/**
 * Properties a Proxy must not answer, or it becomes indistinguishable from a
 * promise and `await` will try to resolve it.
 */
const THENABLE_PROPERTIES = new Set(['then', 'catch', 'finally']);

/**
 * Stand-in for a tenant configured without `getToken`.
 *
 * Calling Heartland is optional, but failing silently is not: every method
 * rejects naming the tenant and the method, so the misconfiguration is obvious
 * from one log line rather than surfacing later as a confusing auth error.
 */
function unavailableClient(tenantId: TenantId): HeartlandApiClient {
  return new Proxy({} as HeartlandApiClient, {
    get(_target, property) {
      // Stay non-thenable and non-exotic so this object cannot be mistaken for
      // a promise and survives inspection by loggers and test matchers.
      if (
        typeof property !== 'string' ||
        THENABLE_PROPERTIES.has(property)
      ) {
        return undefined;
      }

      return () =>
        Promise.reject(
          new Error(
            `Tenant "${tenantId}" has no getToken configured, so ` +
              `${property}() cannot call the Heartland API`
          )
        );
    },
  });
}
