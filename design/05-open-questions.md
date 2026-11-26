# 05 — Open questions

System-level gaps: decisions not yet made that cross module boundaries. Gaps
inside a single module live in that module's own record — core's are in
[`heartland-webhooks-core/design/06-open-questions.md`](../heartland-webhooks-core/design/06-open-questions.md).

When one of these is settled it becomes an [ADR](adr/) and the entry is deleted.
Two were settled on 2026-11-26 — durable retry by
[ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md), and authentication by
[ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md), which replaced it with
the narrower replay question in item 6.

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

## 2. Idempotency is required, and nothing enforces it

[Invariant 5](03-invariants.md) says actions must be idempotent, and nothing
enforces it. Two changes made that load-bearing rather than tidy:

- Queue delivery is at-least-once, so a handler that fails after partially
  completing its writes is re-run from the start
  ([ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md)).
- A forged trigger carrying a real id causes a legitimate record to be
  reprocessed ([ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md)).

So "handlers should be idempotent" is now a requirement with two routine ways to
violate it, and no shared machinery to help. The options are per-handler guards
(easy to forget, invisible when forgotten), a seen-event key with a TTL — which
needs the storage decision from item 1 — or designing each action to be
naturally idempotent, which replication mostly can be: *set* the channel
quantity to what Heartland says, never *adjust* it by a delta.

That last option is the cheapest and should be the default. It does not cover
actions that are inherently one-shot, like posting a notification.

## 3. Reconciliation is named but not designed

[01 — Ecosystem](01-ecosystem.md#inventory-replication) says event-driven
replication drifts and needs a periodic sweep. Nothing specifies what a sweep
compares, how often, what it is allowed to change unattended, or what it does
when a channel and Heartland disagree in a way that is not a simple overwrite
(a listing sold on a channel Clutch does not yet read).

Blocked on nothing except deciding. Worth doing before the BrickLink connector
so sweeping is not retrofitted.

## 4. Which module owns scheduled work

Cron-driven jobs reuse the tenancy layer but not the webhook lifecycle
([02 — Modules](02-modules.md#scheduled-work-has-no-home-yet)). Open: whether
the runner is its own module or part of core; whether core iterates tenants or
the job does; and how a partial failure across tenants is reported when there is
no response body to put it in.

## 5. How a context exposes more than one system

`TenantContext` today carries exactly one system client, Heartland's, because
that is all that exists. With three channels connected, a handler needs clients
for several systems — but a context that eagerly exposes all of them makes every
handler depend on every connector, and makes every deployment hold every
credential.

Likely shape: a lookup the handler asks for what it needs, so dependencies stay
explicit and unused connectors stay unloaded. Undecided, and the first real test
of [ADR-0004](adr/0004-one-module-per-system.md).

## 6. Replay of a valid trigger

Authentication itself is settled, in the only way available:
[ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md) stops trusting the
payload, so a forged body can no longer inject data that never happened. What it
cannot stop is **replay** — a fabricated trigger carrying a real record id makes
us reprocess a real record.

That is a much smaller hole than injection, and two things already blunt it:
reprocessing reads current truth, and idempotent actions make a repeat a no-op
(item 2). What remains unaddressed is an attacker deliberately replaying a high
volume of valid ids, which is a load problem as much as a correctness one — see
the throttling note in ADR-0006, including the sharp edge that a global
concurrency cap returns 429 to Heartland too.

Still worth doing: the [probe](../heartland-webhooks-core/design/06-open-questions.md)
for a signing or shared-secret mechanism. Signing would authenticate the payload
and close this properly. It is no longer a blocker, which is the point of
ADR-0006.

## 7. Per-tenant blast radius is shared

All tenants share one deployment's concurrency, and a channel API rate limit is
usually per account but may be per IP. No per-tenant throttling or cost
attribution exists.

Acceptable at a handful of stores. The lever, if needed, is one deployment per
tenant with the same code — which the tenancy design already supports.

Partly improved by [ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md): a
slow handler now backs up a queue instead of holding a webhook connection open,
so one store's backlog degrades throughput rather than availability. The shared
queue does mean one store's flood is another store's latency, which is the first
thing that would justify splitting queues per tenant.
