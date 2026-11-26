# ADR-0001 — One shared pipeline, thin per-event factories

**Status:** Accepted · **Date:** 2026-10-26

## Context

Core supports two Heartland webhooks (`sales_transaction_completed` and
`item_created`) and will support more. Comparing the two entrypoints, almost
everything is identical: envelope logging, tenant resolution, body validation,
error containment, response shaping, the order those happen in. What differs is
small and enumerable: how to parse the body, what to log about the payload, how
to ask a handler if it is interested, and which method to call.

Error containment is the part that must not drift. If each entrypoint
implemented its own try/catch placement, the guarantee that a handler can never
take the endpoint down would hold in some entrypoints and not others.

## Decision

Put the whole lifecycle in `createWebhookLambda(pipeline)` in
`src/lambda/pipeline.ts`, generic over payload and handler type. Everything that
varies is supplied as a `WebhookPipeline<TPayload, THandler>` record:
`eventType`, `registry`, `resolveTenant`, `logger`, `parse`, `describe`,
`supports`, `handlerName`, `invoke`.

Per-event factories (`createTransactionLambda`, `createItemLambda`) are thin:
build a `TenantRegistry` from the caller's tenants, fill in the record, return
the handler. Neither contains control flow.

`createWebhookLambda` and `WebhookPipeline` are **not** exported from
`src/index.ts`. They are core's internal extension seam, so the lifecycle has
exactly one owner.

## Consequences

- A new event type is a new `parse`/`describe`/`invoke` triple plus tests, with
  the lifecycle inherited.
- Fixing an ordering or containment bug fixes it for every event type at once.
- `describe()` feeds both the log line and the response body, so "what is worth
  saying about this payload" is defined once per event.
- `pipeline.ts` is the single most important file to read, and the single most
  dangerous to change. Branches per event type do not belong in it — an event
  that cannot fit the lifecycle is a design change deserving its own ADR.
- Cost: one layer of generic indirection between a consumer's `createXLambda`
  call and the code that runs.

## Alternatives considered

**A full handler per event type.** More direct to read, and each file is
self-contained. Rejected: the two implementations were ~90% identical, and the
duplicated part is precisely the part where a subtle divergence is invisible.

**A middleware chain.** More flexible per event, but the flexibility is the
problem — the ordering decisions (tenant before parse, parse before token load)
are deliberate and should not be reorderable per event. A fixed lifecycle with
named holes encodes them.

**Class inheritance with an abstract base.** Equivalent in power; rejected in
favour of the record because a plain object of functions is easier to construct
in tests and does not invite protected-member coupling.
