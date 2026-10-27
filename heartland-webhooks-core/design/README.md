# heartland-webhooks-core — Design

Design record for **this package only**: the transport that receives Heartland
Retail webhooks, attributes them to a tenant, parses them, and hands them to
business logic.

For what Clutch is as a whole — the BAM ecosystem, the other systems being
connected, and the rules every module honors — start at the top-level
[design record](../../design/).

**Scope.** This package is tenant-agnostic across Bricks & Minifigs stores, not
across retailers: it models the Heartland standard fields plus the custom fields
BAM corporate mandates for all its stores
([ADR-0005](../../design/adr/0005-assume-bam-item-schema.md)).
`HeartlandItemCustomFields` is the one definition of those fields for every
module.

## Contents

| Document | What it answers |
| --- | --- |
| [01 — Multi-tenancy](01-multi-tenancy.md) | How one deployment serves several Heartland instances |
| [02 — Webhook pipeline](02-webhook-pipeline.md) | The exact lifecycle of one inbound webhook |
| [03 — Heartland client](03-heartland-client.md) | The REST surface and the HTTP layer underneath it |
| [04 — Conventions](04-conventions.md) | Errors, logging, parsing, testing, naming |
| [05 — Extending core](05-extending.md) | Writing a handler, adding an event type, adding an endpoint |
| [06 — Open questions](06-open-questions.md) | Known gaps in this package |
| [ADRs](adr/) | One decision per file, with the alternatives that lost |

## Decisions

| # | Decision |
| --- | --- |
| [0001](adr/0001-pipeline-over-per-event-lambdas.md) | One shared pipeline, thin per-event factories |
| [0002](adr/0002-always-200.md) | Webhook endpoints always answer HTTP 200 |
| [0003](adr/0003-lazy-memoized-tenant-contexts.md) | Lazy, memoized tenant contexts; failures not cached |
| [0004](adr/0004-zero-runtime-dependencies.md) | Zero runtime dependencies |
| [0005](adr/0005-injected-token-loading.md) | Token loading is injected, not implemented here |
| [0006](adr/0006-parse-results-not-exceptions.md) | Parsers return results instead of throwing |

The system-wide decision that this package exists at all —
transport separated from business logic, handlers multi-tenant by construction —
is [ADR-0002](../../design/adr/0002-transport-business-logic-split.md) at the
top level.

## Keeping it honest

Where a document states a behaviour, that behaviour is implemented in `src/` and
covered by `tests/`; file references are given so a claim can be checked in one
jump. A change to an interface in `src/index.ts`, to the pipeline's order of
operations, or to the tenancy model should land with the matching design edit.
Where documentation and code disagree, the code wins and the document is a bug.
