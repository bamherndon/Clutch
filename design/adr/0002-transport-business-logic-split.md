# ADR-0002 — Transport separated from business logic; handlers are multi-tenant

**Status:** Accepted · **Date:** 2026-10-26

## Context

Connecting any system to Clutch involves the same work every time: receive the
event, attribute it to a store, parse a loosely-typed payload, build an
authenticated client for that store, answer safely, and contain failures. Only
*what the event means* varies.

The predecessor system, `OperationalHooks`, had two structural problems:

1. **Plumbing was fused to business logic.** Each handler re-implemented
   envelope logging, parsing, secret loading, and error handling inline,
   interleaved with the checks it cared about. None of it could be reused or
   tested on its own.
2. **One store was assumed.** Base URL, API token, and GroupMe bot id were read
   from `process.env` deep inside handlers and strategies, so one deployment
   could serve only one store.

The second caused a third: because configuration was ambient, a handler could
not be written once and reused across stores.

## Decision

Split every connection along the transport / business-logic line, and make
business logic multi-tenant by construction.

**Transport** (a connector module) owns receiving, tenant attribution, parsing,
client construction, failure containment, and response shaping. It knows that
tenants exist; it knows nothing about any particular store and nothing about any
other system.

**Business logic** (handlers) owns meaning: what an event implies, which systems
to act on, every policy and threshold.

**Tenancy arrives as an argument.** A handler receives a per-invocation context
carrying the tenant's identity, an authenticated client, and a tagged logger.
One handler instance serves every tenant. There is nowhere for per-store state
to hide, so multi-tenancy is a property of the shape rather than a discipline.

The pressure test for where code belongs: *would a different store, with
different policy, want this exact behaviour?* If yes, it can be transport. If
no, it is business logic.

## Consequences

- Business logic is written once and serves every store. Adding a store is a
  registration entry, not a deployment.
- Transport is testable with no network and no credentials, because every
  tenant-varying value arrives through an injectable seam.
- A handler author reads one interface and needs to understand nothing about the
  pipeline.
- Handlers report domain results through an opaque `details` payload that
  transport echoes without modelling, so a new automation never changes
  transport's types.
- A handler holding per-store state is a bug rather than a style choice — the
  one rule reviewers must actually enforce, since nothing in the type system
  catches it.
- Cost: an indirection for the single-store case, and the discipline that
  transport must refuse business logic even when putting it there would be
  quicker.

Worked implementation:
[`heartland-webhooks-core/design/`](../../heartland-webhooks-core/design/).

## Alternatives considered

**One deployment per store, single-tenant each.** Simplest possible code, best
blast-radius isolation. Rejected: transport gets copied per store and then
drifts — which is the situation this design replaces. Note the tenancy model
still *permits* this as a deployment choice.

**A handler instance per store.** The obvious way to carry per-store config.
Rejected: it reintroduces construction-time configuration and makes "is this
handler safe for two stores?" a question you have to answer by reading it.

**Configuration-driven behaviour instead of handlers** — express each store's
rules as data interpreted by transport. Rejected: the rules are genuinely
programs (conditional stock checks, outbound calls, enrichment), and encoding
programs as config ends in a worse language than TypeScript.
