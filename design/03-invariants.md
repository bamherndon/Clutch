# 03 — Invariants

Rules every Clutch module honors. These are the things that, if broken
anywhere, break the system rather than one module — so they are stated once,
here, and inherited.

## 1. Tenancy arrives as an argument

Never from `process.env`, a module-level variable, or a constructor capture.
Everything that varies per store — base URLs, credentials, account ids, logging
identity — reaches code as a per-invocation context parameter.

**Why:** ambient configuration is exactly what made the predecessor system
unable to serve two stores from one deployment. It fails silently, and it fails
in the worst direction: one store's action taken with another store's
credentials.

**Consequence:** business logic is written once and serves every store. A single
handler instance is shared across all tenants, so a handler holding per-store
state is a bug, not a style choice.

## 2. Heartland is the system of record

Inventory truth lives in Heartland. Channels are replicas. When they disagree,
Heartland wins and the channel is corrected.
([ADR-0001](adr/0001-heartland-system-of-record.md))

## 3. Credentials stop at the connector, and reach only the handlers that ask

A connector receives credential *access* and hands out an authenticated client.
Business logic never sees a token. Secret storage and rotation belong to the
deployment module, reached through an injected loader function, so no other
module imports an AWS SDK or knows where secrets live.

A handler receives clients only for the systems it declares
([ADR-0009](adr/0009-handler-specific-contexts.md)), so a credential reaches
exactly the automations that need it and a deployment holds only what its
handlers use.

## 4. A failure in one store, one system, or one handler stays there

One store's broken webhook must not stop another store's. One channel being
down must not block the others. A handler throwing must not take an endpoint
down — a receiving endpoint that keeps erroring gets disabled by the upstream
system, which turns a contained failure into a silent outage.

**Consequence:** failures are contained at the boundary, logged, and — once
past the boundary — parked in a dead-letter queue rather than dropped. The
worked versions are
[ADR-0002 — always answer 200](../heartland-webhooks-core/design/adr/0002-always-200.md)
in core and [ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md) here.

## 5. Assume at-least-once delivery; make actions idempotent

Any event may arrive twice, and any action may be retried. An action that is not
naturally idempotent needs its own guard, and **that guard is the handler's**
([ADR-0008](adr/0008-handlers-own-state-idempotency-recovery.md)) — nothing in
Clutch deduplicates, by decision rather than by omission. This is the most
easily violated invariant on the list;
[06 — Handler responsibilities](06-handler-responsibilities.md) is the list each
handler design answers so a violation is visible in review.

**This is now a correctness requirement, not an expectation.** Queue delivery is
at-least-once, so a handler that fails after partially completing its writes
*will* be re-run from the start
([ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md)). A forged trigger
carrying a real id can also cause a legitimate record to be reprocessed
([ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md)). Both are routine,
not exotic.

**Why it gets worse in phase 2:** a duplicated outbound push is usually
harmless; a duplicated *inbound* channel sale double-decrements real inventory.

## 6. A trigger is not data

An inbound event tells us *that* something happened and which record it
concerns. It is never the source of what happened. Read the record from the
owning system's API, with our own credentials, and act on that
([ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md)).

**Why:** inbound events cannot be authenticated, so their contents cannot be
trusted. Reading the record also makes the id's validity checkable at the edge,
and makes stale or out-of-order events largely self-correcting.

**Consequence:** a connector parses an inbound event only far enough to extract
an id, an event type, and a tenant. A handler that reaches for a field from the
raw event body is reading untrusted input.

## 7. Every action is attributable from logs alone

CloudWatch is the only diagnostic channel — there is no replay tool and no
separate on-call. Every log line carries the tenant, and every failure carries
what failed, for which store, on which system, with the upstream error text
intact.

**Consequence:** logging is a design concern, not an afterthought. A failure
that reads as "request failed" has violated this rule even if it is technically
logged.

## 8. Modules are replaceable in tests

Every external system is reached through an interface or an injected factory, so
a module's own tests run with no network and no AWS. A module that cannot be
tested without credentials has a boundary in the wrong place.

## 9. BAM field names live behind one definition

Clutch assumes the BAM item schema ([ADR-0005](adr/0005-assume-bam-item-schema.md)),
and modules may rely on those custom fields. They read them through the shared
type definition — never by reaching into `custom` with a string literal.

**Why:** the assumption is a scope decision we may revisit. Kept behind one
definition, generalizing means adding a mapping layer; scattered as literals
across connectors and handlers, it means a rewrite. Centralizing also makes the
blast radius of a corporate schema change one file.

**Consequence:** a missing mandated field is reported as a data problem for that
item and the item is skipped — not thrown, and not assumed absent everywhere.

## 10. One system per connector; routing is business logic

A connector never calls another connector. Cross-system rules live in business
logic, so connecting the next system is additive.
([ADR-0004](adr/0004-one-module-per-system.md))
