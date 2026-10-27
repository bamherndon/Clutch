import { HeartlandApiClient } from '../clients/heartland-api-client';
import { Logger } from '../logging/logger';

export type TenantId = string;

/**
 * Everything core knows about one Heartland instance, plus the business-logic
 * plugin that serves it.
 *
 * `getToken` is a function rather than a value so a deployment serving many
 * tenants does not have to load every tenant's credentials at cold start —
 * core calls it on first use and caches the result for the process lifetime.
 */
export interface TenantDefinition<THandler> {
  tenantId: TenantId;
  /** e.g. `https://bamherndon.retail.heartland.us` */
  baseUrl: string;
  getToken(): Promise<string>;
  handler: THandler;
}

/**
 * Per-invocation handle core passes to a business-logic plugin.
 *
 * A plugin should take everything tenant-varying from here rather than from
 * `process.env`, which is what made the previous single-tenant design
 * impossible to run for two Heartland instances at once.
 */
export interface TenantContext {
  tenantId: TenantId;
  baseUrl: string;
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
