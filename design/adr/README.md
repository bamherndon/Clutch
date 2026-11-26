# Architecture Decision Records — system-wide

Decisions that constrain more than one module. A decision affecting only one
module belongs in that module's own `design/adr/`.

Format: context, decision, consequences, alternatives considered. Once
**Accepted**, an ADR is not edited except to mark it superseded — the record of
what we used to think is the point.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-heartland-system-of-record.md) | Heartland is the system of record | Accepted |
| [0002](0002-transport-business-logic-split.md) | Transport separated from business logic; handlers are multi-tenant | Accepted |
| [0003](0003-one-way-now-two-way-destination.md) | One-way replication now; two-way is the destination | Accepted |
| [0004](0004-one-module-per-system.md) | One module per connected system | Accepted |
| [0005](0005-assume-bam-item-schema.md) | Assume the BAM item schema (Heartland standard + BAM-mandated custom fields) | Accepted |
| [0006](0006-webhook-is-a-trigger-api-is-truth.md) | A webhook is a trigger; the API is the source of truth | Accepted |
| [0007](0007-asynchronous-processing-with-dlqs.md) | Asynchronous processing: validate at the edge, enqueue, handle separately | Accepted |
| [0008](0008-handlers-own-state-idempotency-recovery.md) | Handlers own their state, idempotency, and recovery | Accepted |
| [0009](0009-handler-specific-contexts.md) | Each handler declares the context it needs | Accepted |

0006 and 0007 describe the target architecture. The `0.1.0` code is synchronous
and trusts the payload; both ADRs say so, and the rework is tracked as issues.

Module records: [`heartland-webhooks-core`](../../heartland-webhooks-core/design/adr/).
