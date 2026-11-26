# ADR-0007 — Outbound HTTP: bounded timeouts, retry reads only

**Status:** Accepted · **Date:** 2026-11-26

Settles the timeout and retry gaps (formerly open questions 3 and 4). They are
one decision: both are about what `requestJson` owes a caller when Heartland
misbehaves, and both are bounded by the same invocation budget.

## Context

`requestJson` sets no timeout and never retries.

A hung connection therefore holds the invocation until the Lambda's own timeout,
which produces an uninformative failure — "task timed out" names nothing about
which call hung — and burns the full configured duration.

A 429 or a transient 5xx fails the webhook outright. Heartland will not
redeliver, because core answers 200 by design
([ADR-0002](0002-always-200.md)), so the event is simply lost. In-process retry
is the only recovery available at this layer; durable retry is a system-level
decision recorded in the [top-level record](../../../design/05-open-questions.md).

Two facts constrain any answer. First, `createReceiptFromPurchaseOrder` issues
one call per purchase-order line sequentially, so a per-call budget multiplies
by line count. Second, several Heartland writes are **not** idempotent:
`POST /api/purchasing/receipts` and `POST /api/purchasing/receipts/{id}/lines`
each create a record, with no caller-supplied key to deduplicate on.

## Decision

**A 10-second default timeout per request, overridable per call.**
`req.setTimeout` plus `req.destroy`, rejecting with a labelled error that names
the API and the elapsed budget, so a timeout reads as a timeout and not as a
socket error. `JsonRequestOptions` gains an optional `timeoutMs`.

**Retry reads. Never retry writes.** `GET` is retried; `POST`, `PUT`, `PATCH`,
and `DELETE` are not, and not because they are slower — because a retry after a
response that was actually applied would silently double a receipt line. A
request is retried on connection error, timeout, 429, and 5xx. 4xx other than
429 is returned immediately; it will not get better.

**Two retries, exponential backoff with jitter**, honoring `Retry-After` on a
429 when it is present and shorter than the remaining budget.

**The total budget is explicit.** Worst case per call is
`timeoutMs × (1 + retries)` plus backoff, and a caller that loops over lines
multiplies that. The retry policy is therefore configurable per call alongside
the timeout, and the composite methods that loop use a lower budget than a
single-shot read.

## Consequences

- A hung Heartland call fails in ~10s naming the endpoint, instead of killing
  the invocation minutes later with no attribution.
- The common transient failure — one 429, one 502 — stops losing events, which
  is the cheapest reliability win available at this layer.
- **Writes stay fragile on purpose.** A failed `addReceiptLine` is still a lost
  line. That is the correct trade until there is an idempotency key to retry
  against; making writes retryable without one trades a visible failure for a
  silent duplicate. Revisit if Heartland exposes a dedupe key.
- `createReceiptFromPurchaseOrder` becomes the method most likely to exhaust an
  invocation on a large PO, since its per-line calls now each carry a retry
  budget. Its own budget must be set with the Lambda timeout in mind.
- Retry makes a call's duration non-deterministic, so tests must inject the
  policy (zero retries, tiny timeout) rather than wait on real backoff.
- Still no runtime dependency: `setTimeout`, `destroy`, and a backoff loop are a
  few dozen lines ([ADR-0004](0004-zero-runtime-dependencies.md)). This is the
  cost that ADR anticipated.

## Alternatives considered

**Retry everything, including writes.** Better recovery on paper. Rejected: a
duplicate receipt line is worse than a missing one, because the missing one is
reported and the duplicate is not.

**No timeout, rely on the Lambda timeout.** Status quo. Rejected: it discards
the information about *which* call hung, which is the only thing that makes the
failure actionable from logs.

**A single global timeout constant, no per-call override.** Simpler. Rejected:
a single read and a 200-line receipt loop cannot share one budget.

**Retry at the pipeline level instead** — re-invoke the handler on failure.
Rejected: a handler is not idempotent in general, and the pipeline cannot know
how far it got. Retry belongs at the one place that knows the request is a safe
read.
