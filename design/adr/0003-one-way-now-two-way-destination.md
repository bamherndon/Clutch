# ADR-0003 — One-way replication now; two-way is the destination

**Status:** Accepted · **Date:** 2026-10-26

## Context

The goal is that each sales channel offers what Heartland says is in stock. The
complete version of that is two-way: Heartland pushes listings and quantities
out, and a sale on BrickLink or eBay comes back to decrement Heartland and,
through it, the other channels. Two-way is what actually prevents selling the
same physical brick twice.

Two-way is also where all the hard problems are: loop prevention (our own push
must not read as a channel event), write contention on Heartland, duplicate
delivery with real consequences, and reconciliation when a channel and Heartland
disagree for reasons neither side can explain.

Building all of that before a single listing has ever been published would mean
designing against guesses about channel APIs we have not used in anger yet.

## Decision

**Phase 1: one-way.** Clutch replicates Heartland outward. Channel sales are
handled outside Clutch.

**Phase 2: two-way, and it is the known destination.** Not a maybe. The
boundaries are drawn now so inbound channel events have somewhere to land:

- Every connected system is classified as event source, action target, or both
  — and the channels are documented as *both*, with their source side inactive
  ([01 — Ecosystem](../01-ecosystem.md)).
- Connectors own both directions for their system, so inbound ingestion is a
  module's internal growth rather than a new module
  ([ADR-0004](0004-one-module-per-system.md)).
- Heartland stays the system of record in both phases, so phase 2 adds a path
  without changing the conflict rule
  ([ADR-0001](0001-heartland-system-of-record.md)).
- Idempotency is an invariant from the start ([03 — Invariants](../03-invariants.md)),
  because the cost of violating it rises sharply in phase 2.

What phase 1 deliberately does **not** do: build dedup storage, loop
prevention, or inbound plumbing on spec. Those get designed when there is a real
channel to design against.

## Consequences

- The first milestone is reachable: publish inventory to a channel and keep it
  updated, without solving distributed-write correctness first.
- Overselling is not solved in phase 1. The mitigation stays what it is today —
  whatever process the stores already use for channel sales — and that should be
  stated plainly rather than implied away.
- Phase 2 will not require re-drawing the module boundaries. It will require new
  design work inside them; that is the intended trade.
- Reconciliation sweeps matter more in phase 1 than they would in a two-way
  system, because an event lost outward has no inbound signal to correct it.
- Risk accepted: designing "for" inbound events without an implementation can
  still get the shape wrong. The guard is that we committed only to
  classification and module ownership — not to an inbound API — so being wrong
  costs a connector's internals, not the system.

## Alternatives considered

**Two-way from the start.** Correct destination, honest about the real problem.
Rejected as a first milestone: it front-loads every hard distributed-systems
question onto a project that has not yet published one listing, and it would be
designed against unfamiliar channel APIs.

**One-way, with two-way left genuinely open.** Rejected: it invites phase-1
shortcuts that are expensive to undo — per-channel conflict rules, stateless
assumptions baked into connector APIs, no idempotency discipline. Naming the
destination costs nothing now and constrains the shortcuts.

**Channel-to-channel sync, skipping Heartland.** Rejected by
[ADR-0001](0001-heartland-system-of-record.md): N² sync paths and no
authoritative side.
