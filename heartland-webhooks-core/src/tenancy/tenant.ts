import { HeartlandApiClient } from '../clients/heartland-api-client';
import { Logger } from '../logging/logger';

export type TenantId = string;

/**
 * Configuration for one Heartland instance.
 *
 * This is configuration only — it carries no business logic. A deployment
 * registers one of these per store and a single multi-tenant handler serves
 * them all.
 *
 * `getToken` is a function rather than a value so a deployment serving many
 * tenants does not have to load every tenant's credentials at cold start: core
 * calls it on the tenant's first request and caches the result for the process
 * lifetime.
 */
export interface TenantConfig {
  tenantId: TenantId;
  /** e.g. `https://bamherndon.retail.heartland.us` */
  baseUrl: string;
  /**
   * Resolves this tenant's Heartland API token.
   *
   * Optional, and only needed to call Heartland back. Core uses it to build the
   * authenticated client exposed as {@link TenantContext.heartland}; handlers
   * never see the token itself. Omit it for a tenant whose handler only reads
   * the webhook payload, and `context.heartland` will reject with a clear error
   * if something does try to use it.
   */
  getToken?: () => Promise<string>;
}

/**
 * Per-invocation handle core passes to a handler.
 *
 * A handler is shared across every tenant, so everything tenant-varying must be
 * taken from here rather than from constructor state or `process.env` — reading
 * tenant configuration from the environment is what made the previous design
 * impossible to run for two Heartland instances at once.
 */
export interface TenantContext {
  tenantId: TenantId;
  baseUrl: string;
  /**
   * Heartland REST client bound to this tenant's base URL and token.
   *
   * Every method rejects with an explanatory error if the tenant was configured
   * without `getToken`.
   */
  heartland: HeartlandApiClient;
  logger: Logger;
}

/**
 * Thrown when an incoming webhook cannot be attributed to a known tenant.
 */
export class UnknownTenantError extends Error {
  constructor(
    readonly attemptedTenantId: string | undefined,
    readonly knownTenantIds: TenantId[]
  ) {
    super(
      attemptedTenantId
        ? `Unknown tenant "${attemptedTenantId}"; known tenants: ${knownTenantIds.join(', ') || '(none)'}`
        : `Could not resolve a tenant from the request; known tenants: ${knownTenantIds.join(', ') || '(none)'}`
    );
    this.name = 'UnknownTenantError';
  }
}
