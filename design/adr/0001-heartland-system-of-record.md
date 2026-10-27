# ADR-0001 — Heartland is the system of record

**Status:** Accepted · **Date:** 2026-10-26

## Context

Clutch connects several systems that each hold a version of "what we have in
stock": Heartland Retail at the till, and a BrickLink / eBay / FB Marketplace
listing per item we're selling online. Any system that joins several stateful
systems has to answer one question before anything else: **when two of them
disagree, which one is right?**

Without an answer, every sync path needs its own conflict rule, and the rules
contradict each other.

## Decision

**Heartland is the system of record for inventory and sales.** Channels are
replicas of it.

- Heartland state is authoritative. When a channel disagrees, the channel is
  corrected.
- Channels are not asked to merge. Clutch overwrites channel state to match
  Heartland rather than reconciling field by field.
- In phase 2, an inbound channel sale is a *report of a physical event* that
  Clutch applies to Heartland. Heartland then becomes authoritative for the
  result, and the other channels follow from it — a channel never propagates
  directly to another channel.

## Consequences

- Conflict resolution is a single rule applied everywhere: Heartland wins.
- Reconciliation has a defined direction — compare, then correct the channel.
  A sweep never has to decide which side is stale.
- Channels remain fan-out replicas, so adding one does not add conflict paths:
  N systems means N sync paths, not N².
- Heartland becomes a hard dependency and a single point of failure. If
  Heartland is unavailable, replication stops; that is accepted, because it is
  already the system the stores cannot operate without.
- Heartland write volume concentrates in phase 2, when every channel sale
  becomes a Heartland write. Worth watching; not a reason to decentralize.
- Something true only on a channel (channel-specific pricing, listing text,
  promotional state) has no home in Heartland. Where that state lives is not
  settled by this ADR, and inventory truth is not the place for it.

## Alternatives considered

**Per-channel authority** — each channel owns the items listed on it. Rejected:
inventory is physical and shared. Two channels cannot both be authoritative for
the same brick without overselling it.

**Clutch holds its own canonical inventory**, syncing Heartland as just another
replica. Genuinely more flexible, and it would decouple channels from Heartland
availability. Rejected: it makes Clutch a system of record, which means it must
be durable, reconcilable, and auditable — a much larger product than an
integration hub. The till is where stock physically changes; truth belongs
there.

**Last-write-wins across systems.** Rejected: it produces exactly the silent,
unattributable drift that replication exists to prevent.
