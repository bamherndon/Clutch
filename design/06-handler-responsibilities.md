# 06 — Handler responsibilities

Handlers own their state, idempotency, and recovery
([ADR-0008](adr/0008-handlers-own-state-idempotency-recovery.md)). Nothing in
Clutch checks any of it.

So this is the list every handler's own design record has to answer. Not a
style guide — these are the things that are *silently* wrong in production if
nobody thinks about them. An unanswered item here is a gap in that handler's
design, visible in review rather than in a store's inventory.

## 1. Idempotency — what happens when this runs twice?

It will. Queue delivery is at-least-once, a redelivered message re-runs the
handler **from the start**, and a replayed trigger can fetch a real record again
([ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md),
[ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md)).

Answer:

- Is each action naturally idempotent? Prefer **set** over **adjust**: "set the
  channel quantity to 3" survives any number of repeats; "decrement by 1" does
  not. Most of replication can be expressed the first way, and should be.
- For anything one-shot — a notification, an order submission, a receipt line —
  what makes a repeat detectable? The message's `idempotencyKey` is available,
  but using it means storing what has been done (item 2).
- What happens on a *partial* re-run — the handler succeeded on BrickLink,
  failed on eBay, and is now re-running both?

## 2. State — what does this remember, and where?

Anything remembered is this handler's own: identity mappings, cursors,
"already done" markers.

Answer:

- What has to be remembered, and can it be **derived** instead? A mapping
  recovered from a channel's own data (an SKU that round-trips, a lookup by
  catalog id plus our account) is strictly better than one we store, because it
  cannot drift out of sync with reality.
- If stored: what store, what schema, what lifecycle, who pays for it.
- **Is every key partitioned by `tenantId`?** One handler instance serves every
  store, so unpartitioned state is a cross-store data leak, not a bug.
- What happens when the store is unavailable — fail the message, or proceed
  degraded?

## 3. Concurrency — can two runs collide?

Two messages for the same record can be in flight at once. Ordering is largely
self-correcting because every run reads current truth, but simultaneity is not.

Answer:

- Is this action read-then-write? If so, two concurrent runs can both read the
  old value and both write.
- Does it need serialization per record — a FIFO queue keyed by record id, a
  conditional write, a lock — or is last-write-wins genuinely fine?

## 4. Failure and recovery — what does a DLQ entry mean?

The handler's retries happen inside its own Lambda. When they are exhausted it
throws, and the message lands in the handler DLQ.

Answer:

- How many internal retries, with what backoff, and does the total fit inside
  the Lambda timeout? A retry budget that exceeds it produces a timeout instead
  of a DLQ entry.
- Is the action resumable, or does a mid-way failure leave the target system in
  a state someone has to fix by hand?
- **What does an operator do with a DLQ entry from this handler?** Replay it,
  or investigate first? That answer belongs in the handler's design, because the
  operator will not derive it.

## 5. The target system's limits

Answer:

- What are the rate limits, and are they per account, per IP, or per endpoint?
- What does the handler do on a 429 — back off inside the invocation, or fail
  and let redelivery space it out?
- Does a burst of Heartland events translate into a burst on the target? One
  sale can mean several channel updates.

Outbound call volume is instrumented at the system level
([05 — Open questions](05-open-questions.md)), but reacting to a limit is the
handler's job.

## 6. Credentials and context

A handler receives exactly the systems it declares
([ADR-0009](adr/0009-handler-specific-contexts.md)).

Answer:

- Which systems does it need? Each one widens the blast radius and adds a
  credential every deployment must hold.
- Is everything tenant-varying taken from the context rather than the
  constructor or the environment ([invariant 1](03-invariants.md))?

## 7. Observability

There is no synchronous response any more, so the handler is the only thing that
can say what it did.

Answer:

- What does a successful run log, in one line, that lets an operator confirm it
  did the right thing?
- What does a *skipped* run log? A handler whose `supports()` declines, or that
  decides there is nothing to do, should not be indistinguishable from one that
  never ran.
- What is worth a metric rather than a log line — counts of listings updated,
  calls made, items skipped for missing data?

## 8. Data assumptions

Answer:

- Which BAM-mandated custom fields does it rely on
  ([ADR-0005](adr/0005-assume-bam-item-schema.md))?
- What does it do when a mandated field is **blank on a particular item**? That
  is a data problem for that item: report it and skip, do not crash and do not
  guess.
- Which Heartland records does it refuse to act on at all, and is that visible?
