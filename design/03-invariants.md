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

## 3. Credentials stop at the connector

A connector receives credential *access* and hands out an authenticated client.
Business logic never sees a token. Secret storage and rotation belong to the
deployment module, reached through an injected loader function, so no other
module imports an AWS SDK or knows where secrets live.

## 4. A failure in one store, one system, or one handler stays there

One store's broken webhook must not stop another store's. One channel being
down must not block the others. A handler throwing must not take an endpoint
down — a receiving endpoint that keeps erroring gets disabled by the upstream
system, which turns a contained failure into a silent outage.

**Consequence:** failures are contained at the boundary, reported in the
response body, and logged — not propagated. The worked version of this is
[ADR-0002 — always answer 200](../heartland-webhooks-core/design/adr/0002-always-200.md)
in core.

## 5. Assume at-least-once delivery; make actions idempotent

Any event may arrive twice, and any action may be retried. An action that is not
naturally idempotent needs its own guard. Nothing in Clutch deduplicates today,
which makes this the most easily violated invariant on the list — tracked in
[05 — Open questions](05-open-questions.md).

**Why it gets worse in phase 2:** a duplicated outbound push is usually
harmless; a duplicated *inbound* channel sale double-decrements real inventory.

## 6. Every action is attributable from logs alone

CloudWatch is the only diagnostic channel — there is no replay tool and no
separate on-call. Every log line carries the tenant, and every failure carries
what failed, for which store, on which system, with the upstream error text
intact.

**Consequence:** logging is a design concern, not an afterthought. A failure
that reads as "request failed" has violated this rule even if it is technically
logged.

## 7. Modules are replaceable in tests

Every external system is reached through an interface or an injected factory, so
a module's own tests run with no network and no AWS. A module that cannot be
tested without credentials has a boundary in the wrong place.

## 8. BAM field names live behind one definition

Clutch assumes the BAM item schema ([ADR-0005](adr/0005-assume-bam-item-schema.md)),
and modules may rely on those custom fields. They read them through the shared
type definition — never by reaching into `custom` with a string literal.

**Why:** the assumption is a scope decision we may revisit. Kept behind one
definition, generalizing means adding a mapping layer; scattered as literals
across connectors and handlers, it means a rewrite. Centralizing also makes the
blast radius of a corporate schema change one file.

**Consequence:** a missing mandated field is reported as a data problem for that
item and the item is skipped — not thrown, and not assumed absent everywhere.

## 9. One system per connector; routing is business logic

A connector never calls another connector. Cross-system rules live in business
logic, so connecting the next system is additive.
([ADR-0004](adr/0004-one-module-per-system.md))
