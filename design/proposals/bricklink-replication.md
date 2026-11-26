# Proposal — BrickLink inventory replication

**Status:** Proposed · **Date:** 2026-11-26 · Spans two modules, so it lives here
rather than in either one. On acceptance it splits: the client half into the
BrickLink connector's record, the business-logic half into the handler's.

Replicate Heartland inventory onto a tenant's BrickLink store: what Heartland
says is in stock should be what BrickLink is offering.

## What the API forces

Three facts about BrickLink's Store API decide most of this design.

**1. You cannot look up your own lot by item number.** `GET /inventories`
filters on `item_type`, `status`, `category_id`, and `color_id` — there is no
`item_no` filter, and the inventory resource has no external-id field. Finding
"our lot for Heartland item 10234" means either remembering its `inventory_id`
or scanning the whole inventory.

**2. The writable fields are `item.no` + `item.type` + `color_id` + `quantity` +
`unit_price` + `new_or_used` + `completeness` + `description` + `remarks`** (plus
bulk/retain/stockroom flags). `remarks` and `description` are free text we
control — the only place we can stamp our own identity.

**3. Auth is OAuth 1.0a, HMAC-SHA1.** `requestJson`'s `authorization` escape
hatch exists for exactly this; the predecessor already has working signing code
to port.

## Identity: a cache, not a system of record

The mapping from a Heartland item to a BrickLink lot is resolved in three tiers,
cheapest first:

| Tier | Mechanism | Cost |
| --- | --- | --- |
| 1 | `MappingStore` — `(tenantId, heartlandItemId) → inventory_id` | one read |
| 2 | Full-inventory scan, indexed by the Heartland id stamped in `remarks` | one large fetch |
| 3 | Full-inventory scan, matched on `item.no` + `color_id` + `new_or_used` | same fetch, fuzzier |

**Every lot we create carries its Heartland item id in `remarks`.** That is what
makes tier 2 possible, and it is the point of the design: the BrickLink
inventory becomes self-describing, so the mapping store is a **rebuildable
cache** rather than authoritative state. Lose it and a sweep reconstructs it.

That matters for [ADR-0008](../adr/0008-handlers-own-state-idempotency-recovery.md).
Handlers own their state, and the cheapest state to own is state you can
regenerate — no backup story, no migration story, and a corrupted entry is
self-healing.

Tier 3 exists because lots created by hand, before Clutch or beside it, will not
carry a stamp. It is a heuristic and can mis-match; it should log loudly and
never silently overwrite a lot it is not sure about.

## Catalog translation

`ListingPlanner`'s whole job, and now specified. Everything keys off
`custom.sub_department` — the field the item parser already reads as
`subDepartment`.

| `sub_department` | `item.type` | `new_or_used` | `completeness` |
| --- | --- | --- | --- |
| New In Box | SET | `N` | `S` sealed |
| Retired New In Box | SET | `N` | `S` sealed |
| Certified Used Set | SET | `U` | `C` complete |
| Used Set | SET | `U` | `C` if pre-built, else `B` incomplete |
| Collectible Minifig | MINIFIG | `U` | — not applicable |
| Casefig | MINIFIG | `U` | — not applicable |
| **anything else** | — | — | **not listed** |

**Pre-built comes from `custom.bam_category`**, not from the sub-department.
Confirmed against a real used set (`75317-1`):

```json
"custom": {
  "tags": "BrickHeadz,Used Set,Pre-Built Set,add",
  "department": "Used Sets",
  "sub_department": "Used Set",
  "bam_category": "Pre-Built Set",
  "bricklink_id": "75317-1",
  "upc": ""
}
```

So the one conditional row reads: `sub_department` is *Used Set* **and**
`bam_category` is *Pre-Built Set* → `C`, otherwise `B`. Note `tags` carries the
same two facts as free text; the typed custom fields are the ones to read, not
the tag string.

**Match on a normalized value — trimmed and case-folded — against this table,
and treat an unmapped value as a counted, logged skip.** Spelling then stops
being load-bearing, and a sub-department nobody mentioned shows up as a rising
skip count instead of silence. Worth knowing the real values differ in number:
the *department* is "Used Sets" while the *sub-department* is "Used Set".

### `bricklink_id` is the catalog number, and it is already right

`bricklink_id` on that item is `75317-1` — exactly BrickLink's `item.no` format
for a set. It goes straight into `item.no` with no transformation, which is the
whole reason catalog identity needs no mapping store.

It also happens to equal `public_id` on this item. **Do not rely on that.** One
item is not a convention, and if BAM's SKU and the BrickLink number diverge
anywhere, `bricklink_id` is the field that is *meant* to carry it.

### Listability preconditions, from the real record

The sub-department table decides *how* to list. These decide *whether* to:

| Condition | Why |
| --- | --- |
| `active?` is true | an inactive item should not be on sale |
| `track_inventory?` is true | without tracking there is no on-hand figure to replicate. `BAM10000` (Bulk Loose Pieces) has it false |
| `prompt_for_price?` is false **and** `price > 0` | a prompt-for-price item has no price to publish. `BAM10000` has `price: 0` and prompts |
| `bricklink_id` is non-empty | nothing to list against |
| `sub_department` maps in the table above | everything else is filtered out |

**Empty string is the absent case, not `undefined`.** `upc` on that item is
`""`, and `BAM10000`'s `custom` object omits `sub_department`, `bam_category`
and `bricklink_id` entirely. So a field is present only if it is non-empty after
trimming — two different shapes of missing, one check. This is
[ADR-0005](../adr/0005-assume-bam-item-schema.md)'s "mandated does not mean
populated" showing up in the first two items we looked at.

Two corrections the API forces on the rule as stated:

- **`completeness` is SET-only** (values `C`, `B`, `S`). So "collectible minifig
  and casefig are used and complete" becomes `new_or_used: U` with completeness
  omitted — there is no field to carry "complete" for a minifig.
- **Confirm `completeness: S` is accepted alongside `new_or_used: N`** on the
  first create. Sealed is meaningful for a new set, but the docs describe
  completeness as complete-or-incomplete, so this is worth proving rather than
  assuming.

### Quantity, and a thing the live data shows

```
quantity = max(0, onHand)
```

Not a defensive flourish. Pulling real inventory by department turned up
negative on-hand in several of them — Bulk at −5899, Parties/Events at −89,
Convenience at −9 — and the predecessor carries an
`inventory-non-negative-strategy`, so negative stock is a known condition rather
than a glitch.

A negative quantity must never reach BrickLink. Clamp to zero, which means "not
listed", and **count it separately from a legitimate zero** — the two look
identical on the channel and mean very different things in the store.

None of those departments list under the sub-department table above, so this is
belt-and-braces today. It stops being belt-and-braces the moment a listable
sub-department goes negative.

## Module split

The connector owns BrickLink; the handler owns what a Heartland event means for
it ([ADR-0004](../adr/0004-one-module-per-system.md),
[ADR-0002](../adr/0002-transport-business-logic-split.md)).

```mermaid
classDiagram
    class BrickLinkTransactionHandler {
        +name: string
        +supports(record) bool
        +handleTransaction(record, ctx) Promise~Outcome~
    }
    class BrickLinkItemHandler {
        +name: string
        +supports(record) bool
        +handleItemCreated(record, ctx) Promise~Outcome~
    }
    class InventoryReplicator {
        +syncItem(ctx, heartlandItemId) Promise~SyncResult~
        +syncItems(ctx, ids) Promise~SyncResult[]~
    }
    class ListingPlanner {
        +plan(item, onHandQty) DesiredLot | Skip
    }
    class LotLocator {
        +locate(ctx, item) Promise~LotRef | NotListed~
        +rebuildIndex(ctx) Promise~IndexStats~
    }
    class MappingStore {
        <<interface>>
        +get(tenantId, itemId) Promise~number | undefined~
        +put(tenantId, itemId, inventoryId) Promise~void~
        +forget(tenantId, itemId) Promise~void~
    }
    class BrickLinkContext {
        <<interface>>
        +tenantId: string
        +logger: Logger
        +bricklink: BrickLinkClient
        +heartland: HeartlandApiClient
        +mappings: MappingStore
    }
    class BrickLinkClient {
        <<interface>>
        +listInventories(filter) Promise~Lot[]~
        +createInventory(draft) Promise~Lot~
        +updateInventory(id, patch) Promise~Lot~
        +deleteInventory(id) Promise~void~
        +getItem(type, no) Promise~CatalogItem~
    }
    class DefaultBrickLinkClient {
        -consumerKey
        -tokenValue
        -signOAuth1(method, url) string
    }

    BrickLinkTransactionHandler ..> InventoryReplicator
    BrickLinkItemHandler ..> InventoryReplicator
    InventoryReplicator ..> ListingPlanner
    InventoryReplicator ..> LotLocator
    InventoryReplicator ..> BrickLinkContext
    LotLocator ..> MappingStore
    LotLocator ..> BrickLinkClient
    BrickLinkClient <|.. DefaultBrickLinkClient
    BrickLinkContext ..> BrickLinkClient
    BrickLinkContext ..> MappingStore
```

Why these seams:

- **`ListingPlanner` is pure.** Heartland item + on-hand quantity in, a desired
  lot or a reason to skip out. No I/O, so every catalog-translation and
  BAM-schema rule is unit-testable without a network or a fake store. This is
  where `bricklinkId`, condition, and price mapping live.
- **`InventoryReplicator` is the only thing that writes.** Both handlers are
  thin adapters over `syncItem`, so "what it means to be in sync" has one
  implementation, shared with the sweep.
- **`LotLocator` hides the three tiers**, so callers never think about the cache.
- **`BrickLinkContext` declares exactly two systems and a store** — not a context
  holding every client ([ADR-0009](../adr/0009-handler-specific-contexts.md)).
  It needs `heartland` because a sale tells it *which* items changed, not what
  they now are.

## Sync one item

The unit of work. Set, never adjust — which is what makes it idempotent under
redelivery and replay.

```mermaid
sequenceDiagram
    participant R as InventoryReplicator
    participant H as Heartland
    participant P as ListingPlanner
    participant L as LotLocator
    participant B as BrickLink

    R->>H: GET /items/{id}
    R->>H: GET /inventory/values?item_id={id}
    H-->>R: item + on-hand qty
    R->>P: plan(item, qty)
    alt no bricklinkId, or unmappable
        P-->>R: Skip(reason)
        R-->>R: log + count, no write
    else listable
        P-->>R: DesiredLot
        R->>L: locate(item)
        alt mapping hit
            L->>B: GET /inventories/{inventory_id}
        else miss
            L->>B: GET /inventories
            L-->>L: index by remarks stamp, then by no+color+condition
        end
        alt lot exists and qty > 0
            R->>B: PUT /inventories/{id} (quantity, unit_price)
        else lot exists and qty == 0
            R->>B: DELETE or PUT quantity 0
        else not listed and qty > 0
            R->>B: POST /inventories (stamped remarks)
            R->>L: remember(itemId, inventory_id)
        else not listed and qty == 0
            R-->>R: nothing to do
        end
    end
```

## A sale

```mermaid
sequenceDiagram
    participant D as Dispatcher
    participant T as BrickLinkTransactionHandler
    participant H as Heartland
    participant R as InventoryReplicator

    D->>T: handleTransaction(ticket record, ctx)
    T->>T: supports? — sale or return, has lines
    T->>H: GET /sales/tickets/{id}/lines
    H-->>T: lines
    T->>T: distinct item ids with an item_id
    loop each affected item
        T->>R: syncItem(ctx, itemId)
    end
    T-->>D: Outcome{ok, details: {synced, skipped, failed}}
```

The handler does **not** compute the new quantity from the sale. It re-reads
Heartland's on-hand figure per item and pushes that. A delta would be wrong the
moment a message is redelivered or two sales of the same item are processed at
once; re-reading is correct under both, and it is the concrete form of "set, not
adjust".

A partial failure fails the message so it retries and eventually reaches the
handler DLQ — which is safe precisely because every step is idempotent.

## The sweep

```mermaid
sequenceDiagram
    participant S as Scheduled sweep
    participant B as BrickLink
    participant H as Heartland
    participant R as InventoryReplicator

    S->>B: GET /inventories
    B-->>S: every lot
    S->>S: rebuild mapping index from remarks stamps
    S->>H: inventory values by department
    H-->>S: every item with stock
    S->>S: diff: in Heartland not BrickLink · in BrickLink not Heartland · qty mismatch
    loop each difference
        S->>R: syncItem(ctx, itemId)
    end
    S->>S: report counts + unmatched lots
```

**The sweep is not optional for BrickLink, and this is the part worth arguing
with.** Heartland emits `sales_transaction_completed` and `item_created`.
Nothing tells us about **receiving stock, manual adjustments, transfers, or
price changes** — so a lot whose quantity changed for any of those reasons stays
wrong until a sweep notices. Event-driven replication covers sales and new
items; everything else is sweep territory. That makes the scheduled-work
decision ([#21](https://github.com/bamherndon/Clutch/issues/21)) a dependency of
BrickLink going live, not a follow-up.

## The eight handler responsibilities

Answering [06 — Handler responsibilities](../06-handler-responsibilities.md),
since a design that skips these is incomplete by definition.

| # | Concern | Answer |
| --- | --- | --- |
| 1 | **Idempotency** | Every write sets absolute state from Heartland. Re-running `syncItem` is a no-op. Creating a lot is the one non-idempotent act, guarded by `locate()` running first — and a double-create is recoverable: the sweep finds two stamped lots and merges. |
| 2 | **State** | `MappingStore`, keyed `(tenantId, heartlandItemId)`. A rebuildable cache, not truth. Tenant in the key, always. |
| 3 | **Concurrency** | Two sales of one item can be in flight together, and both do read-then-write. Both read current Heartland truth, so the loser writes the same value — benign. The real race is two creates for an unlisted item; mitigation is `locate()` immediately before create, accepting that the sweep cleans up the rare duplicate. |
| 4 | **Failure and recovery** | Per-item failures are collected, not thrown, so one bad item does not abandon the rest of a ticket; the handler then fails the message if any item failed. A DLQ entry means "re-run this ticket" and is always safe to replay. |
| 5 | **Rate limits** | BrickLink documents a daily request cap — **confirm the current number**. A full-inventory fetch is one call; per-item syncs are 2 Heartland + 1–2 BrickLink. The sweep is the thing most likely to exhaust a daily budget, so it needs a ceiling and the ability to resume. |
| 6 | **Context** | `tenantId`, `logger`, `bricklink`, `heartland`, `mappings`. Two systems because a sale names items but does not describe them. |
| 7 | **Observability** | Per run: items synced, created, updated, deleted, skipped-with-reason, failed. Skips are the interesting number — a rising "no bricklinkId" count is a data-quality signal, and it must not look like silence. |
| 8 | **Data assumptions** | Requires `bricklinkId` on an item to list it at all; missing is a per-item data problem, reported and skipped ([ADR-0005](../adr/0005-assume-bam-item-schema.md)). |

## What I need from you

These are store-policy and data questions, not technical ones, and the design is
blocked on them in the places noted.

1. **Should `available_online?` gate listing?** It is `false` on the used set
   above. If the store already uses that flag to mean "sell this online", it is
   the natural switch for replication — and it would give staff per-item control
   without touching Clutch. If it means something else, say so and I will leave
   it out. This is the only question that could still change the planner's shape.
2. **Is a casefig a MINIFIG to BrickLink?** The table assumes so. If a casefig
   is catalogued as something else, its `item.type` is wrong and every create
   fails.
3. **Which fields do we own?** Quantity, certainly. Price? Description? If
   Clutch owns `unit_price`, nobody can price-adjust on BrickLink by hand
   without being overwritten. This is [#24](https://github.com/bamherndon/Clutch/issues/24).
4. **Zero stock.** Delete the lot, or keep it at quantity 0? Also needs
   verifying whether BrickLink auto-removes a lot at zero.
5. **Creating listings.** Should `item_created` publish a listing immediately
   (quantity 0 until stock arrives), or should a listing appear only when stock
   first exists? The second is less chatty; the first makes the catalog mapping
   fail early and visibly.
6. **Multi-location.** `GET /inventory/values` groups by item **and location**.
   Is a tenant's BrickLink stock one location's on-hand, or the sum?
7. **Colour.** Sets and minifigs take `color_id` 0. Confirmed by the
   sub-department table — no parts list, so colour is never load-bearing. Flag
   if that changes.

## Open risks

- **Tier-3 matching can mis-identify a hand-made lot.** It must refuse
  ambiguous matches rather than guess, and say so in the log.
- **A full-inventory fetch is the hot spot.** If an inventory grows into the
  thousands of lots, per-event tier-2 fallback becomes too expensive and the
  mapping store stops being optional.
- **`remarks` may already be in use** for storage location or similar. If so,
  the stamp needs a delimited convention rather than owning the field — check
  before designing around it.
