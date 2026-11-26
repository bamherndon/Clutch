# ADR-0009 — Each handler declares the context it needs

**Status:** Accepted · **Date:** 2026-11-26

Closes the multi-system-context gap (formerly open question 5).

## Context

`TenantContext` today carries exactly one system client — Heartland's — because
that is the only system connected. With BrickLink, eBay, and FB Marketplace
connectors, the obvious extension is to widen it: add `bricklink`, `ebay`, `fb`
alongside `heartland` and hand every handler the lot.

That gets worse with every system. A BrickLink handler would depend on the eBay
connector it never calls. Every deployment would have to hold credentials for
every system, including the ones its handlers do not touch. And a widened
context makes the blast radius of adding a connector equal to the whole handler
layer.

## Decision

**A handler declares the context it needs, and the dispatcher composes exactly
that.**

A BrickLink handler asks for a BrickLink context: the tenant's identity, a
logger, and a BrickLink client bound to that tenant's BrickLink account. It does
not receive a Heartland client it does not use, and it has no way to reach eBay.

What stays universal is small and system-independent: `tenantId` and `logger`.
Everything else is composed per handler from the connectors it names.

Consequences for the mechanics, to settle in implementation rather than here:
the handler's context type is part of its contract, the dispatcher builds it
from the connector factories registered for that handler, and a credential is
loaded only when a handler that needs it actually runs — the same laziness
`getToken` already has
([ADR-0005 in core](../../heartland-webhooks-core/design/adr/0005-injected-token-loading.md)).

## Consequences

- **Dependencies are visible in the type.** What a handler can touch is what it
  asked for, so "does this automation write to eBay?" is answered by reading its
  signature rather than its body.
- **Deployments hold only the credentials their handlers need.** A store that is
  not on eBay yet needs no eBay credentials anywhere, and a handler cannot
  accidentally be pointed at a system the store has not onboarded.
- **Adding a connector touches no existing handler.** This is what makes
  [ADR-0004](0004-one-module-per-system.md)'s "additive" claim true in practice
  rather than in principle.
- **Least privilege falls out of it.** A compromised or buggy handler reaches
  only the systems in its context.
- Costs: more types than one shared context, and some wiring in the dispatcher
  to assemble per-handler contexts. A handler that genuinely needs three systems
  declares three, and that verbosity is the honest signal that it is doing a lot.
- `TenantContext` as it exists in core becomes the *Heartland* context — one
  composed context among several, not the universal one. Its name should follow
  eventually; renaming it is not urgent while Heartland is the only connector.
- Cross-system orchestration still lives in a handler, which means a handler
  that pushes to three channels does hold three clients. The decision bounds what
  a handler *can* reach, not how much one handler is allowed to do.

## Alternatives considered

**One context with every system's client.** Simplest to write, and the default if
nobody decides. Rejected above: it couples every handler to every connector and
every deployment to every credential.

**A service-locator context** — `context.client('bricklink')`, resolved at
runtime. Nearly as decoupled and much less typing. Rejected because the
dependency stops being visible in the signature and a missing connector becomes
a runtime error in a handler rather than a compile error at wiring time.

**Pass clients as constructor arguments instead of on the context.** Tempting,
and it is how non-tenant-varying dependencies are already handled. Rejected for
clients: they are per-tenant, and a handler instance serves every tenant
([ADR-0002](0002-transport-business-logic-split.md)), so a client in a
constructor is the per-store state this design exists to prevent.
