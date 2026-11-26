# 05 — Open questions

System-level gaps: decisions not yet made that cross module boundaries. Gaps
inside a single module live in that module's own record — core's are in
[`heartland-webhooks-core/design/06-open-questions.md`](../heartland-webhooks-core/design/06-open-questions.md).

When one of these is settled it becomes an [ADR](adr/) and the entry is deleted.

Ordered by how much they block.

## 1. Clutch has no persistent state, and replication needs some

A Heartland item has to map to *our listing* of it on each channel — a BrickLink
lot, an eBay listing — per store, since each store lists separately. Nothing in
Clutch stores that mapping. Everything so far is stateless by design: an event
arrives, an action is taken, nothing is remembered.

Catalog identity is a separate and easier question: `bricklinkId` is a
BAM-mandated custom field, so *which product this is* is likely already in the
data ([ADR-0005](adr/0005-assume-bam-item-schema.md)). What is missing is
*which of our listings represents it*.

This blocks the BrickLink connector, so it is the next real decision.

The shape of the question, not just the storage choice:
- **Is the mapping derivable or stored?** If a channel listing can carry the
  Heartland item id in a field it round-trips (an SKU, a remark field), the
  mapping is derivable and Clutch may stay stateless. That would be worth a
  lot, and it is the first thing to check per channel. A channel that lets us
  look up a listing by catalog id plus our own account also makes it derivable.
- **If stored:** what owns it? A store per connector, or one shared mapping
  table keyed by (tenant, system, heartland item id)?
- **What else wants to be stored once it exists?** Dedup keys (item 2), sync
  cursors, reconciliation results. A datastore introduced for mapping will be
  asked to hold all of it, so the decision is bigger than it first looks.

## 2. No deduplication or idempotency enforcement

[Invariant 5](03-invariants.md) says actions must be idempotent, and nothing
enforces it. Each handler is responsible for its own guard, which is easy to
forget and invisible when forgotten.

A system-level dedup — a seen-event key with a TTL — needs the storage decision
from item 1. Tolerable in phase 1, where duplicate pushes are mostly harmless;
not tolerable in phase 2, where a duplicated channel sale double-decrements real
inventory.

## 3. No durable retry; a failed action is simply lost

Work happens inline in one invocation. Core answers 200 unconditionally so
upstream endpoints are never disabled, which means the upstream system will not
redeliver either — a transient channel API failure drops the action, and the
channel stays wrong until a reconciliation sweep catches it.

Options: in-process retry with backoff (cheap, belongs in each connector); a
queue between receiving and acting (correct, and a real architectural change —
it splits "answer the webhook" from "do the work"); or lean on reconciliation
sweeps as the backstop and accept per-event loss.

Coupled to item 4: if sweeps are trustworthy, losing an individual event matters
much less.

## 4. Reconciliation is named but not designed

[01 — Ecosystem](01-ecosystem.md#inventory-replication) says event-driven
replication drifts and needs a periodic sweep. Nothing specifies what a sweep
compares, how often, what it is allowed to change unattended, or what it does
when a channel and Heartland disagree in a way that is not a simple overwrite
(a listing sold on a channel Clutch does not yet read).

Blocked on nothing except deciding. Worth doing before the BrickLink connector
so sweeping is not retrofitted.

## 5. Which module owns scheduled work

Cron-driven jobs reuse the tenancy layer but not the webhook lifecycle
([02 — Modules](02-modules.md#scheduled-work-has-no-home-yet)). Open: whether
the runner is its own module or part of core; whether core iterates tenants or
the job does; and how a partial failure across tenants is reported when there is
no response body to put it in.

## 6. How a context exposes more than one system

`TenantContext` today carries exactly one system client, Heartland's, because
that is all that exists. With three channels connected, a handler needs clients
for several systems — but a context that eagerly exposes all of them makes every
handler depend on every connector, and makes every deployment hold every
credential.

Likely shape: a lookup the handler asks for what it needs, so dependencies stay
explicit and unused connectors stay unloaded. Undecided, and the first real test
of [ADR-0004](adr/0004-one-module-per-system.md).

## 7. No request authentication anywhere

Core trusts anything that reaches its function URL; tenant ids are routing keys,
not credentials. That is a core-level gap, but the decision is system-level
because every future connector that receives inbound events inherits it — and in
phase 2 those inbound events will be channel sales that move real inventory.

Settle the scheme once, here, rather than per connector.

## 8. Per-tenant blast radius is shared

All tenants share one deployment's concurrency, and a channel API rate limit is
usually per account but may be per IP. No per-tenant throttling or cost
attribution exists.

Acceptable at a handful of stores. The lever, if needed, is one deployment per
tenant with the same code — which the tenancy design already supports.
