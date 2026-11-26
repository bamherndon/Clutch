# ADR-0005 — Assume the BAM item schema

**Status:** Accepted · **Date:** 2026-10-26

## Context

A Heartland item is a set of Heartland-defined fields plus **custom fields**,
which each retailer configures for itself. Nothing in Heartland guarantees that
two instances define the same custom fields.

Clutch's tenants are other **Bricks & Minifigs stores**, and Bricks & Minifigs
corporate mandates a set of custom fields for all its stores. So across the
tenants Clutch actually serves, the item schema is known and consistent — not
because Heartland enforces it, but because the franchise does.

That matters because almost every useful automation needs to read product
meaning out of an item, not just its id: which department it belongs to, what
theme or series it is, what it maps to in a channel's catalog. A system that
assumes nothing about custom fields can sync quantities and little else.

## Decision

**Assume every tenant has the Heartland standard fields plus the BAM-mandated
custom fields, and build against them.**

- Modules may depend on BAM-mandated custom fields as present and meaningful.
- Clutch is *not* being generalized to arbitrary retailers now. Supporting a
  non-BAM store is explicitly out of scope. We may generalize further later, or
  we may not.
- The dependency must stay **visible and centralized**: custom fields are read
  through one shared type definition, not through string literals scattered
  across modules. Today that definition is `HeartlandItemCustomFields` in
  `heartland-webhooks-core`.
- A missing or empty mandated field is a **data problem for that item**, to be
  reported and skipped, not a crash and not an assumption that it is absent
  everywhere. Corporate mandating a field does not mean every item has it filled
  in.
- The index signature on the item model stays, so a store's own extra custom
  fields remain reachable without being modelled.

## Consequences

- Automations can be written against product meaning, which is the difference
  between replicating quantities and replicating *listings*.
- **It partially answers the identity-mapping gap.** `bricklinkId` is already a
  BAM-mandated custom field, so the Heartland item → BrickLink *catalog* mapping
  is likely derivable from the data rather than something Clutch must store. The
  per-store *lot* id — our listing of that catalog item, with its own price and
  quantity — is still ours to track or re-derive. See open question 1 in
  [05 — Open questions](../05-open-questions.md).
- Onboarding a new BAM store requires no field mapping configuration. That is
  the main practical win.
- "Tenant-agnostic" in module docs means **agnostic across BAM stores**, not
  across retailers. `heartland-webhooks-core` already carries BAM-specific
  fields (`bamCategory`, `bricklinkId`) in its item model, which is consistent
  with this ADR and inconsistent with a stricter reading of its own name.
- The cost of generalizing later is bounded by how well the centralization rule
  is kept. If BAM field names stay behind one definition, generalizing means
  adding a schema-mapping layer; if they leak into connectors and handlers as
  literals, it means a rewrite.
- Risk: corporate changes the mandated set, or a store fills fields
  inconsistently. The first is a coordinated edit in one place; the second is
  the per-item data problem described above, and it is why validation reports
  rather than throws.

## Alternatives considered

**Model only Heartland's standard fields; treat all custom fields as opaque.**
The genuinely generic choice. Rejected: it rules out the automations that
motivate Clutch — listing creation, catalog translation, department-based
routing — because none of them can be expressed without product meaning.

**Per-tenant field mapping configuration** — each store declares which of its
custom fields plays which role. This is the real generalization, and it is where
we would go to support a non-BAM retailer. Rejected for now as solving a problem
we do not have: every tenant on the roadmap is a BAM store with an identical
mandated schema, and the configuration would be identical for all of them.

**Infer the schema at runtime** from what a tenant's items actually contain.
Rejected: it trades a known, documented assumption for silent per-tenant
behaviour differences that are discovered in production.
