# ADR-0004 — One module per connected system

**Status:** Accepted · **Date:** 2026-10-26

## Context

Clutch will connect Heartland, BrickLink, eBay, FB Marketplace, and later vendor
sites and others. Each system brings an API client, its own auth scheme, its own
vocabulary for products and quantities, its own rate limits, and — eventually —
its own inbound events.

How those are packaged decides what it costs to connect the fifth system.

## Decision

**One module per connected system — a connector — owning both directions.** A
connector contains that system's API client, its event ingestion, and its
outbound actions.

Two rules make the boundary real:

1. **A connector never calls another connector.** It knows its own system
   deeply and no other.
2. **A connector never contains a cross-system rule.** Routing and policy live
   in business logic, which is the only layer that sees more than one system at
   once.

"When stock drops below three, delist on BrickLink but keep the eBay listing" is
business logic, even though every noun in it belongs to a connector. The
pressure test: would a different store with different policy want this exact
behaviour? If no, it is not connector code.

Both directions live together rather than being split into inbound and outbound
modules, because the thing that is genuinely hard to share is *knowledge of the
system* — its auth, its catalog, its quirks — and that knowledge serves both
directions.

## Consequences

- Connecting a system is additive: a new connector plus the handler rules that
  use it. No existing connector is touched, so N systems means N sync paths
  rather than N².
- Phase 2 is growth inside an existing module rather than a new one — a channel
  connector's inbound side activates where its outbound side already lives
  ([ADR-0003](0003-one-way-now-two-way-destination.md)).
- A connector can be developed and tested against one system's sandbox in
  isolation.
- Rate limits, retries, and auth refresh are per-system concerns and land
  naturally in the module that owns the system.
- Business logic accumulates dependencies on several connectors, making it the
  module most likely to grow unwieldy. That is accepted: the alternative is
  spreading cross-system knowledge into places that cannot see the whole rule.
- Open consequence: a handler needs clients for several systems, and a context
  that eagerly exposes all of them makes every handler depend on every connector.
  How a context exposes N systems is open question 6 in
  [05 — Open questions](../05-open-questions.md), and the first real test of this
  ADR.
- Naming note: the first connector is `heartland-webhooks-core`, named before
  this framing existed. Its name describes a transport, not a system.

## Alternatives considered

**Split by direction** — separate modules for ingesting events from a system and
for acting on it. Tempting in phase 1, where Heartland is the only source and
channels are only targets. Rejected: it doubles the module count, splits each
system's auth and catalog knowledge across two packages, and the split stops
matching reality in phase 2 when every channel becomes both.

**One module per integration pair** (heartland-to-bricklink,
heartland-to-ebay). Rejected: each pair re-implements its half of both systems,
and the count grows multiplicatively.

**A single module with a client per system.** Simplest to start, and reasonable
at two systems. Rejected: no boundary means no enforcement — cross-system rules
drift into system-specific code, and the system-knowledge each client carries
starts leaking into the others.
