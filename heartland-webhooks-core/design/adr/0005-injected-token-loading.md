# ADR-0005 — Token loading is injected, not implemented in core

**Status:** Accepted · **Date:** 2026-10-26

## Context

Each tenant has a Heartland API token that core needs in order to build that
tenant's client. Where the token lives is a deployment decision: Secrets
Manager, SSM Parameter Store, an encrypted environment variable, a local file
during development, a literal string in a test.

Core has no basis for choosing, and any choice it made would be wrong for at
least one of those contexts.

## Decision

`TenantConfig.getToken` is an **optional** function the caller supplies:

```ts
interface TenantConfig {
  tenantId: TenantId;
  baseUrl: string;
  getToken?: () => Promise<string>;
}
```

Core calls it on first use for that tenant and caches the result for the process
lifetime ([ADR-0003](0003-lazy-memoized-tenant-contexts.md)). It never learns
where the token came from.

A function rather than a `string` value for two reasons: it keeps secret
*loading* out of core entirely, and it makes registering a tenant free, so a
deployment can register twenty tenants without loading twenty secrets at cold
start.

### Why optional

The token's only purpose is to let core build the authenticated client exposed
as `TenantContext.heartland`. A handler never sees it. So a tenant whose handler
only reads the webhook payload — no writes back, no lookups — has no use for a
credential, and requiring one would be asking a deployment to provision a secret
to satisfy a type.

Omitting it does not leave a hole in the context. `heartland` is always present,
but for a credential-less tenant it is a stand-in whose every method rejects
with a message naming the tenant and the method:

```
Tenant "bamreston" has no getToken configured, so getTicketLines() cannot call the Heartland API
```

An `undefined` client would have failed later and further away — at the first
call site, as a `TypeError` attributed to the handler. Failing at the point of
use, with the tenant named, keeps the diagnosis to one log line.

The stand-in is a `Proxy`, which carries one non-obvious constraint: it must
refuse `then`, `catch`, `finally`, and symbol properties. A `Proxy` that answers
`then` is a *thenable*, so `await`ing it tries to resolve it as a promise and
hangs rather than yielding the client. Review caught exactly that;
`tests/tenancy/registry.test.ts` pins it.

Two further seams follow the same shape:

- `clientFactory?: HeartlandClientFactory` — substitute the Heartland client
  (tests, non-AWS callers).
- `logger?: Logger` — substitute logging; `NoopLogger` for tests.

## Consequences

- Secret management lives entirely in the infrastructure module, where the IAM
  policy that grants access also lives. The two stay together.
- Core needs no AWS SDK, which is a large part of
  [ADR-0004](0004-zero-runtime-dependencies.md) being achievable.
- Tests use `getToken: async () => 'tenant-token'` — no mocking of AWS clients.
- Rotation strategy, caching beyond the process, and failure retries at the
  secret-store level are all the caller's business. Core only guarantees it will
  not cache a failure.
- Core cannot validate that a token is *correct*, only that it is non-empty. A
  wrong-but-present token surfaces as 401s from Heartland, in the client's error
  text, with the tenant tag in the log prefix.
- Cost: every deployment must write its own small token loader. That is a few
  lines, and it is the right few lines to own.

## Alternatives considered

**Secrets Manager directly in core, with the secret name per tenant.** Fewer
lines for the real deployment. Rejected: it imports the AWS SDK into core, makes
local and test runs require AWS mocks, and bakes one secret store into a package
whose job is transport.

**`token: string` on the config.** Simplest signature. Rejected because it
pushes eager loading onto the caller at cold start for every tenant, including
inactive ones, and it puts a live credential in a long-lived configuration
object.

**A mandatory `getToken`.** What this ADR originally specified. Rejected on
review: it forces a deployment to provision a secret for a tenant that will
never call Heartland, in order to satisfy a type rather than a requirement.

**An environment-variable convention** (`HEARTLAND_TOKEN_<TENANT>`). Rejected:
reading tenant configuration from `process.env` is the exact pattern the
multi-tenant redesign exists to eliminate — see
[ADR-0002](../../../design/adr/0002-transport-business-logic-split.md).
