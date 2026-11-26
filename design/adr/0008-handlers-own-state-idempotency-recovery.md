# ADR-0008 — Handlers own their state, idempotency, and recovery

**Status:** Accepted · **Date:** 2026-11-26

Closes the persistent-state gap (formerly open question 1) and the
idempotency-enforcement gap (formerly open question 2).

## Context

Replication needs things remembered. A Heartland item has to map to *our
listing* of it on each channel; a handler that is not naturally idempotent needs
a record of what it has already done; a sync that resumes needs a cursor.

Clutch has no persistent state, and the open questions framed that as one
system-level decision to make: pick a datastore, define a shared mapping table
keyed by (tenant, system, record), add a dedup key with a TTL, and have every
handler use it.

That framing assumed the needs are the same across handlers. They are not. A
BrickLink handler needs a lot id per item per store. A GroupMe notifier needs
nothing, or a "already announced this" marker with a short life. An eBay handler
may need neither if eBay can round-trip a SKU. A shared store sized for the
union of those is bigger than any of them needs and couples all of them to one
schema.

## Decision

**Each handler owns its own state, its own idempotency, and its own recovery.**

- There is no system-level datastore, no shared mapping table, and no
  framework-level deduplication.
- A handler that needs to remember something chooses its own storage and owns
  its schema, lifecycle, and cost.
- A handler is responsible for being safe under redelivery and replay. The
  queue message carries an `idempotencyKey`, but nothing enforces that a handler
  uses it.
- A handler is responsible for its own recovery story: what a DLQ entry means
  for it, and what replaying one does.
- **Each handler's design record documents how it meets these.**
  [06 — Handler responsibilities](../06-handler-responsibilities.md) is the list
  every handler design has to answer, so "we forgot about concurrency" is
  visible in review rather than in production.

**Any handler state must be partitioned by tenant.** One handler instance serves
every store ([ADR-0002](0002-transport-business-logic-split.md)), so state that
is not keyed by `tenantId` is a cross-store data leak, not just a bug.

## Consequences

- Handlers stay independent. Adding one introduces no shared schema migration,
  and a handler that needs nothing stores nothing.
- The BrickLink connector is unblocked without first choosing a datastore — the
  thing that was previously described as the largest gap in the design. It gets
  to answer the mapping question in the way that suits BrickLink, including
  possibly not storing anything at all if a lot is derivable from `bricklinkId`
  plus our own account.
- **Duplication is accepted.** If BrickLink and eBay handlers both end up
  storing a Heartland-item-to-listing mapping, that is two stores with similar
  shapes. The cost of extracting a shared one later is lower than the cost of
  designing it now for needs we cannot yet state.
- **Idempotency has no safety net.** It is a correctness requirement
  ([invariant 5](../03-invariants.md)) that nothing checks. The mitigation is
  cultural and structural: prefer naturally idempotent actions — *set* channel
  state to what Heartland says, never *adjust* by a delta — and make the
  handler's design record say how it is safe under redelivery.
- Operational recovery becomes per-handler rather than uniform. An operator
  draining a DLQ needs to know which handler produced the entry and what that
  handler's replay semantics are. That is part of why operational recovery needs
  its own design pass ([05 — Open questions](../05-open-questions.md)).
- Nothing here changes the *system's* responsibility for not losing events: the
  queue and both DLQs still do that
  ([ADR-0007](0007-asynchronous-processing-with-dlqs.md)).

## Alternatives considered

**A shared datastore with a mapping table and a dedup key.** The original plan,
and genuinely tidier for operators — one place to look. Rejected: it has to be
designed for the union of every handler's needs before any handler exists to
state them, and it couples unrelated automations through one schema.

**Framework-enforced idempotency** — the dispatcher records every processed
`idempotencyKey` and skips repeats. Attractive, and it would make the invariant
real rather than aspirational. Rejected for now because it requires exactly the
shared store this ADR declines, and because "processed" is not well defined for
a handler that partially completed. Worth revisiting if the same guard keeps
being written by hand.

**No state anywhere; derive everything on every event.** The purest option, and
the goal where it is achievable — a derivable mapping is strictly better than a
stored one. Rejected as a rule because it cannot be guaranteed for every channel,
and a handler that needs a cursor cannot pretend otherwise.
