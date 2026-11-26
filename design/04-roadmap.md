# 04 — Roadmap

Sequencing, and the reasoning behind the order. Not dates.

## Where we are

`heartland-webhooks-core` is implemented and tested: Heartland events arrive,
get attributed to a tenant, get parsed, and reach a handler with an
authenticated client. The event side of the system of record is done.

`OperationalHooks` remains the deployed system and is untouched. Nothing in
Clutch is in production yet, so until cutover there is no migration pressure —
only feature parity to reach.

## 1 — The asynchronous rework

Split receiving from handling, with a queue between them, and stop trusting the
webhook payload: the receiver extracts an id, reads the authoritative record
from the Heartland API, and enqueues it; the handler runs in its own Lambda off
the queue; failures at either stage land in a dead-letter queue
([ADR-0006](adr/0006-webhook-is-a-trigger-api-is-truth.md),
[ADR-0007](adr/0007-asynchronous-processing-with-dlqs.md)).

**Why first:** it changes the handler contract. Handlers consume an API record
rather than a parsed webhook body, they own their own retries, and they must be
idempotent because queue delivery is at-least-once. Porting business logic onto
the old contract first would mean porting it twice.

It also retires the most expensive trade in the design — answering 200 and
therefore losing anything that fails — which is worth having in place before
real automations depend on it.

## 2 — Business logic from `OperationalHooks`

Port the Bricks & Minifigs Herndon handlers onto the new contract: transaction
strategies, item image sourcing, GroupMe alerts, and the BrickLink/Toyhouse
clients they use.

**Why here:** it is the only work that proves the core/handler split against
real behaviour rather than against a test double. If the contract is wrong, it
is wrong here, before three connectors depend on it — and now against the
contract we actually intend to keep.

Done when the ported handlers are multi-tenant by construction — the same
instance serving two tenants — rather than ported as-is.

## 3 — Deployment, and cutover

A CDK app: a function URL per event type, the queue and both dead-letter queues,
reserved concurrency for throttling (and CloudFront/WAF if per-IP limiting is
wanted), IAM, secret storage, log retention, and the real `getToken`. Then run Clutch alongside `OperationalHooks` before
switching Heartland's webhooks over.

**Why before connectors:** parity with the deployed system is the milestone that
retires the predecessor. Starting a new channel first leaves two systems to
operate indefinitely.

## 4 — Scheduled work

A runner for cron-driven jobs — `undersold-items`, `receive-open-orders`, and
the reconciliation sweeps replication will need. Reuses the tenancy layer, not
the webhook lifecycle ([02 — Modules](02-modules.md#scheduled-work-has-no-home-yet)).

**Why here:** it is parity work, *and* it is the prerequisite for replication
being trustworthy. Event-driven sync drifts; without a sweep that compares and
corrects, every missed webhook is permanent.

## 5 — BrickLink connector

The first new system, and the first real test of the ecosystem design: catalog
translation, identity mapping (Heartland item ↔ BrickLink lot, per store), and
the credential-per-(tenant, system) model from
[01 — Ecosystem](01-ecosystem.md#tenancy-multiplies-across-systems).

**Why BrickLink first:** it is the channel we already have client code and
working knowledge for, its catalog is the closest match to how Heartland
describes inventory, and it forces the identity-mapping decision — the largest
open gap — to be settled on the easiest possible case.

Expect this one to change the module boundaries. That is the point of doing it
before eBay and FB Marketplace.

## 6 — eBay, then FB Marketplace

Repeat with the pattern BrickLink established. Each should be mostly connector
work plus handler rules; if either requires changing core or the tenancy model,
the BrickLink pass under-generalized and that is worth an ADR.

## Later

- **Phase 2, two-way sync.** Channel sales flow back into Heartland. The real
  overselling fix, and a design effort in its own right — loop prevention, write
  contention, duplicate delivery with teeth
  ([ADR-0003](adr/0003-one-way-now-two-way-destination.md)).
- **More systems.** Vendor sites, Patron. Not yet characterized as event sources
  or action targets, which is the first question to ask of each.

## The order in one line

Get the processing shape right, prove the contract, retire the predecessor, make
sync trustworthy, then add channels one at a time — hardest-to-generalize
first.
