# ADR-0008 — Reload a tenant context on 401, rather than expiring it

**Status:** Accepted · **Date:** 2026-11-26

Settles the token-rotation gap (formerly open question 5).

## Context

`TenantRegistry` memoizes a tenant's context — and therefore its token — for the
life of the process ([ADR-0003](0003-lazy-memoized-tenant-contexts.md)). That is
what makes a warm Lambda load each secret exactly once.

It also means a rotated token is not noticed. The warm process keeps presenting
the old one until the next cold start, and the symptom is a run of 401s from
Heartland rather than anything that looks like a cache problem.

A TTL is the obvious fix and a poor one: it guesses a rotation interval, serves
a stale token for up to the TTL anyway, and re-loads secrets on a schedule that
has nothing to do with when rotation actually happened. Nothing in `getToken`'s
contract — `() => Promise<string>` — carries an expiry to schedule from.

## Decision

**No TTL. Treat a 401 as the invalidation signal.**

- `TenantRegistry` exposes `invalidate(tenantId)`, which drops the memoized
  context so the next request rebuilds it and re-calls `getToken`.
- When Heartland answers 401 (or 403), the tenant's context is invalidated and
  the call is retried **exactly once** with a freshly loaded token.
- If the retry also fails to authenticate, the webhook fails with a reason that
  says the credential was refused after a reload — distinguishing a rotated
  token from a wrong one.
- One reload per call, tracked per call and not per process, so a persistently
  bad secret cannot loop.
- A failed reload is not cached, consistent with ADR-0003.

## Consequences

- Rotation costs one failed call in each warm process, then self-heals. No
  redeploy, no cold-start wait, and no scheduled secret loads.
- The signal is exact rather than estimated: we reload when the credential is
  actually refused, which is the only moment we know something changed.
- A genuinely wrong secret now costs two calls per invocation instead of one.
  Acceptable, and it is reported rather than silent.
- This is the one place the client's HTTP status has to reach back into tenancy,
  so the seam has to be deliberate: the registry owns `invalidate`, and the
  reload-once wrapper lives where the client is constructed. Nothing else may
  invalidate a context — a handler clearing a credential it cannot see would be
  nonsense.
- Retry-once-on-401 interacts with [ADR-0007](0007-outbound-http-timeouts-and-retries.md):
  401 is **not** in the retryable set there, precisely because retrying it is
  only useful after a reload. The two mechanisms must not both fire.
- A write that 401s is retried once after reload. That is safe in a way general
  write retry is not: a 401 means the request was rejected before it was
  applied.

## Alternatives considered

**A TTL on the cached context.** Rejected above: it guesses, and it still serves
a stale token until it expires.

**Proactive refresh before expiry.** The right answer for credentials that carry
an expiry. Rejected: `getToken` returns a bare string, so there is nothing to
schedule from without widening the contract for a benefit rotation does not
need.

**Invalidate on any failure.** Rejected: a 500 or a timeout says nothing about
the credential, and reloading a secret on every transient blip adds load and
noise for no reason.

**Leave it to cold starts.** The status quo, and honestly survivable at current
volumes. Rejected because the failure is both silent and confusing — 401s that
nothing in the logs attributes to caching — and the fix is small.
