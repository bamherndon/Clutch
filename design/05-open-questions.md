# 05 — Open questions

System-level gaps: decisions not yet made that cross module boundaries. Gaps
inside a single module live in that module's own record — core's are in
[`heartland-webhooks-core/design/06-open-questions.md`](../heartland-webhooks-core/design/06-open-questions.md).

When one of these is settled it becomes an [ADR](adr/) and the entry is deleted.
Five were settled on 2026-11-26 — see [Settled](#settled) at the end.

Ordered by how much they block.

## 1. Operational recovery has no design and no home

Every recovery path is cron-driven or operator-driven, none fit the webhook
lifecycle, and none have anywhere to live:

- **The reconciliation sweep** — compare Heartland to each channel, correct
  drift. [01 — Ecosystem](01-ecosystem.md#inventory-replication) says
  event-driven replication needs one; nothing says what it compares, how often,
  what it may change unattended, or what it does when the two disagree in a way
  that is not a simple overwrite.
- **Missed-window replay** — a throttled or disabled endpoint loses events with
  nothing recording the gap, because dead-letter queues only hold what we
  received. Scoped in [issue #20](https://github.com/bamherndon/Clutch/issues/20);
  needs a home and a trigger.
- **DLQ drains** — uniform for the core DLQ (re-fetch), but **per handler** for
  the handler DLQ, since handlers own their recovery
  ([ADR-0008](adr/0008-handlers-own-state-idempotency-recovery.md)). The runbook
  therefore cannot be one page of generic steps.
- **Where the runner lives** — scheduled work reuses the tenancy layer but not
  the webhook lifecycle: no request, nothing to attribute a tenant *from*.
  Whether it is its own module or part of core is undecided
  ([02 — Modules](02-modules.md#scheduled-work-has-no-home-yet)).

The distinction worth keeping while designing any of it: **replay is
event-shaped and needs a time window; a sweep is state-shaped and needs none.**
A good sweep may make replay unnecessary.

Tracked for design in [issue #21](https://github.com/bamherndon/Clutch/issues/21).
It matters more here than it would elsewhere: CloudWatch is the only diagnostic
channel and the people who run the stores run this, so a recovery path that
needs a specialist is the wrong design.

## 2. Idempotency is required and nothing enforces it

Handlers own it ([ADR-0008](adr/0008-handlers-own-state-idempotency-recovery.md))
and [invariant 5](03-invariants.md) requires it, but no machinery checks it —
while two routine paths violate it: at-least-once delivery re-runs a handler
that failed partway through its writes, and a replayed trigger refetches a real
record (item 4).

Deliberately not closed by building a framework guard, which would need the
shared datastore ADR-0008 declines. What makes it survivable instead:

- Prefer naturally idempotent actions — **set** channel state to what Heartland
  says, never **adjust** by a delta. Most of replication can be written this
  way.
- Each handler's design record states how it is safe under redelivery
  ([06 — Handler responsibilities](06-handler-responsibilities.md), item 1).

What remains genuinely open is whether that holds. If the same hand-rolled guard
keeps appearing in handler after handler, the framework-level version earns its
keep and this becomes an ADR.

## 3. What "in sync" means, per channel

Related to item 1 but distinct: even with a sweep designed, each channel needs
its own answer for what correct looks like. A BrickLink lot has a condition and
a price; an eBay listing has a category and a format. Replicating a quantity is
easy; deciding whether a *listing* is right is per channel, and nothing has
specified it.

First real answer comes with the BrickLink connector, which is also where the
identity-mapping question gets answered now that handlers own their own state.

## 4. Replay of a valid trigger

Authentication is settled in the only way available:
[ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md) stops trusting the
payload, so a forged body cannot inject data that never happened. What it cannot
stop is **replay** — a fabricated trigger carrying a real record id makes us
reprocess a real record.

Smaller than injection, and blunted by two things: reprocessing reads current
truth, and idempotent actions make a repeat a no-op (item 2). What remains is an
attacker replaying valid ids at volume, which is a load problem as much as a
correctness one — see the throttling note in ADR-0006, including the sharp edge
that a global concurrency cap returns 429 to Heartland too.

Still worth doing: the
[probe](../heartland-webhooks-core/design/06-open-questions.md) for a signing
mechanism. Signing would authenticate the payload and close this properly. It is
no longer a blocker, which is the point of ADR-0006.

## 5. Capacity is shared, and unmeasured

All tenants share one deployment's capacity, and a channel API rate limit may be
per account or per IP. No per-tenant throttling or cost attribution exists.

**Decided: measure first, scale when the numbers say so.** Instrument outbound
calls per (tenant, system, operation), plus queue depth, queue age, DLQ depths,
and receiver 429s — then pick a lever. Tracked in
[issue #22](https://github.com/bamherndon/Clutch/issues/22).

Still open: which lever. In rough order of cost — dispatcher concurrency and
batching, per-handler backoff, a queue per event type, a queue or deployment per
tenant (which the tenancy design already supports).

Partly improved already by
[ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md): a slow handler backs
up a queue instead of holding a webhook connection open, so one store's backlog
degrades throughput rather than availability. The shared queue does mean one
store's flood is another store's latency.

## Settled

| Was | Now |
| --- | --- |
| No durable retry; a failed action is lost | [ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md) — queue plus two DLQs |
| No request authentication anywhere | [ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md) — stop trusting the payload; narrowed to item 4 |
| Clutch has no persistent state, and replication needs some | [ADR-0008](adr/0008-handlers-own-state-idempotency-recovery.md) — each handler owns its own |
| No deduplication or idempotency enforcement | [ADR-0008](adr/0008-handlers-own-state-idempotency-recovery.md) — handler responsibility; narrowed to item 2 |
| How a context exposes more than one system | [ADR-0009](adr/0009-handler-specific-contexts.md) — a handler declares what it needs |
