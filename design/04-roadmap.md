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

## 2 — Deployment

A CDK app: a function URL per event type, the queue and both dead-letter queues,
reserved concurrency for throttling (and CloudFront/WAF if per-IP limiting is
wanted), IAM, secret storage, log retention, and the real `getToken`.

**Why here:** nothing ships without it. This is not a cutover — Clutch runs
*alongside* `OperationalHooks`, which keeps doing what it already does.

One thing to confirm while building it: whether Heartland permits **two
registered webhooks for the same event**, so Clutch and `OperationalHooks` can
both receive while they coexist. If it does not, the two systems have to be
sequenced rather than run side by side, which would change this plan.

## 3 — Scheduled work

A runner for cron-driven jobs — `undersold-items`, `receive-open-orders`, and
the reconciliation sweeps replication will need. Reuses the tenancy layer, not
the webhook lifecycle ([02 — Modules](02-modules.md#scheduled-work-has-no-home-yet)).

**Why here:** it is the prerequisite for replication being trustworthy.
Event-driven sync drifts; without a sweep that compares and corrects, every
missed webhook is permanent — and a throttled or disabled endpoint can lose a
whole window of them. The predecessor's own jobs (`undersold-items`,
`receive-open-orders`) can come across later; they are running where they are.

## 4 — BrickLink connector

The first new system, and the first real test of the ecosystem design: catalog
translation, identity mapping (Heartland item ↔ BrickLink lot, per store), and
the credential-per-(tenant, system) model from
[01 — Ecosystem](01-ecosystem.md#tenancy-multiplies-across-systems).

**Why BrickLink first:** this is the point of the project. It is the channel we
already have client code and working knowledge for, its catalog is the closest
match to how Heartland describes inventory, and it is the first thing Clutch
would do that `OperationalHooks` does not already do.

Expect this one to change the module boundaries. That is the point of doing it
before eBay and FB Marketplace.

## 5 — eBay, then FB Marketplace

Repeat with the pattern BrickLink established. Each should be mostly connector
work plus handler rules; if either requires changing core or the tenancy model,
the BrickLink pass under-generalized and that is worth an ADR.

## Later

- **Business logic from `OperationalHooks`.** Deprioritized deliberately: the
  transaction strategies, item image sourcing, and GroupMe alerts are **already
  running** in the predecessor. Porting them produces no new capability, and
  re-porting is cheap to defer. It stops being optional when `OperationalHooks`
  needs to be retired for its own reasons — a change neither system can absorb,
  or the cost of operating two.

  Accepted consequence: the two systems coexist indefinitely, so "which system
  owns which automation" has to stay written down, and the handler contract gets
  proven by new BrickLink work rather than by a port of known-good behaviour.
- **Phase 2, two-way sync.** Channel sales flow back into Heartland. The real
  overselling fix, and a design effort in its own right — loop prevention, write
  contention, duplicate delivery with teeth
  ([ADR-0003](adr/0003-one-way-now-two-way-destination.md)).
- **More systems.** Vendor sites, Patron. Not yet characterized as event sources
  or action targets, which is the first question to ask of each.

## The order in one line

Get the processing shape right, deploy it, make sync trustworthy, then get a
BrickLink store live — and leave what already works alone.
