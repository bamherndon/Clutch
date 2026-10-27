import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { TenantId } from './tenant';

/**
 * Decides which tenant an incoming webhook belongs to.
 *
 * Returns `undefined` when this resolver cannot tell, which lets resolvers be
 * chained with {@link firstOf}.
 */
export type TenantResolver = (
  event: APIGatewayProxyEventV2
) => TenantId | undefined;

/**
 * Read the tenant from a path segment of the request URL.
 *
 * This is the practical choice for Lambda Function URLs, which have no route
 * templates and therefore never populate `pathParameters`. Register each
 * tenant's webhook in Heartland against its own path, e.g.
 * `https://<fn-url>/bamherndon/transaction` with `index: 0`.
 *
 * @param index zero-based index into the non-empty path segments.
 */
export function fromPathSegment(index = 0): TenantResolver {
  return (event) => {
    const segments = (event.rawPath ?? '')
      .split('/')
      .filter((segment) => segment.length > 0);
    return normalize(segments[index]);
  };
}

/**
 * Read the tenant from `event.pathParameters` — for deployments fronted by an
 * API Gateway route such as `/{tenantId}/transaction`.
 */
export function fromPathParameter(name = 'tenantId'): TenantResolver {
  return (event) => normalize(event.pathParameters?.[name]);
}

/**
 * Read the tenant from a request header. Header lookup is case-insensitive.
 */
export function fromHeader(name = 'x-clutch-tenant'): TenantResolver {
  const wanted = name.toLowerCase();
  return (event) => {
    const headers = event.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === wanted) {
        return normalize(value);
      }
    }
    return undefined;
  };
}

/**
 * Read the tenant from a query-string parameter.
 */
export function fromQueryString(name = 'tenant'): TenantResolver {
  return (event) => normalize(event.queryStringParameters?.[name]);
}

/**
 * Always resolve to a fixed tenant. Useful for single-tenant deployments and
 * for tests.
 */
export function fixedTenant(tenantId: TenantId): TenantResolver {
  return () => tenantId;
}

/**
 * Try each resolver in order and return the first non-empty answer.
 */
export function firstOf(...resolvers: TenantResolver[]): TenantResolver {
  return (event) => {
    for (const resolve of resolvers) {
      const tenantId = resolve(event);
      if (tenantId) {
        return tenantId;
      }
    }
    return undefined;
  };
}

function normalize(value: string | undefined): TenantId | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
