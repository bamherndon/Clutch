# ADR-0003 — Lazy, memoized tenant contexts; failures not cached

**Status:** Accepted · **Date:** 2026-10-26

## Context

Serving one webhook requires that tenant's API token and a client built from it.
Token loading is I/O — Secrets Manager, Parameter Store, or whatever the
infrastructure module chooses — so it is slow and it can fail transiently.

Three ways to get this wrong:

- Load every tenant's token at cold start: a deployment with many tenants pays
  for all of them on every cold start, including the inactive ones.
- Load on every invocation: a warm Lambda re-fetches the same secret forever.
- Cache naively: a single transient failure is remembered, and that tenant stays
  broken until the next cold start.

## Decision

`TenantRegistry.context()` caches the **promise** of a `TenantContext` per
tenant, and deletes the cache entry if that promise rejects.

```ts
const pending = this.buildContext(tenant, logger)   // loads the token, builds the client
  .catch((err: unknown) => {
    this.contexts.delete(tenant.tenantId);
    throw err;
  });
this.contexts.set(tenant.tenantId, pending);
```

Three properties follow:

1. **Lazy** — a tenant's token is loaded on the first webhook its handler
   actually accepts, not at cold start. The pipeline asks `supports()` before
   building the context, so an event the handler declines costs nothing. A
   tenant configured without `getToken` loads no secret at all.
2. **Memoized, and race-free** — caching the promise rather than the resolved
   value means two concurrent invocations for the same tenant share one token
   load. A warm Lambda loads each token exactly once.
3. **Failure-transparent** — a rejected load leaves no cache entry, so the next
   invocation retries.

An empty-string token is rejected as a failure rather than accepted as a
credential, so a blank secret produces one clear error at the boundary instead
of a cascade of 401s from Heartland.

## Consequences

- Cold starts are proportional to traffic, not to the number of registered
  tenants.
- A transient secret-store error costs one webhook, not a tenant's availability
  until redeploy.
- A token load failure surfaces as `status: "error"` with
  `reason: "tenant initialization failed: …"` — distinguishable in logs from a
  routing error or a handler failure.
- **No TTL.** A rotated token is not picked up until the next cold start; the
  symptom is 401s from Heartland rather than an obvious cache problem. Tracked
  as [open question 5](../06-open-questions.md).
- The `catch` that deletes the entry must stay. It looks like a redundant
  rethrow and is the whole point of the design — the source comment says so.

## Alternatives considered

**Eager construction in the constructor.** Simpler, synchronous, no cache.
Rejected: it forces every tenant's secret to load on every cold start and makes
registry construction fallible and async.

**Memoize the resolved value, not the promise.** Rejected: concurrent
invocations for the same tenant would each start their own token load.

**Cache failures with a short TTL.** Rejected as unnecessary complexity for the
problem it solves — the natural retry cadence of incoming webhooks is already
the right backoff at these volumes, and a secret store is not a resource that
needs protecting from one retry per webhook.
