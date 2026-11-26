# ADR-0010 — Bound `details` in the response

**Status:** Accepted · **Date:** 2026-11-26

Settles the unbounded-`details` gap (formerly open question 6).

## Context

`WebhookOutcome.details` is opaque to core and echoed verbatim into the response
body. That is deliberate — it is how a handler reports domain results without
core modelling them ([ADR-0002 at the system level](../../../design/adr/0002-transport-business-logic-split.md)).

Nothing bounds it. A handler returning a per-line dump makes every response
heavy and every "Handled webhook" log line long, and the failure mode is gradual:
nobody notices until logs are unreadable and responses are unwieldy. It has been
a convention with no enforcement.

## Decision

**Core caps the serialized size of `details` at 8 KB.**

- Under the cap: echoed verbatim, as today.
- Over it: the response carries `{ truncated: true, bytes: <n> }` in place of the
  value, and the full value is logged once at `debug`.
- The cap is a constant, not a per-caller option, so the response contract is
  the same for every tenant and every handler.
- Replacement rather than clipping: truncating serialized JSON produces invalid
  JSON, and a response that cannot be parsed is worse than one that says it was
  truncated.

8 KB is a judgment, not a platform limit — it is roughly "as much as an operator
will actually read in a terminal", and it sits far below both the Lambda
response limit and the CloudWatch line limit, so neither is the binding
constraint.

## Consequences

- `details` keeps doing its job — operator visibility — and stops being usable
  as a bulk data channel.
- A handler with a lot to say logs it rather than returning it. `context.logger`
  is the right channel for volume; the response is for summary.
- A handler that returns something large sees the truncation marker and the byte
  count, which is enough to tell it apart from a bug.
- The full value survives at `debug`, so the information is recoverable in a
  deployment with debug enabled, without costing anything in production
  (`debug` is suppressed by default).
- Serializing to measure means `JSON.stringify` on `details` happens before the
  response is assembled. At webhook volumes that is free; it is still one more
  thing done on the success path.

## Alternatives considered

**Keep it a convention and document the expectation.** The status quo. Rejected:
the convention is invisible at the moment it is violated, and the cost lands on
whoever next reads the logs rather than on the handler author.

**Clip the serialized JSON at N bytes.** Rejected: produces invalid JSON.

**Make the cap configurable per lambda.** Rejected: it makes the response
contract vary by deployment, and no caller has a reason to want a different
number.

**Reject the outcome outright and report an error.** Rejected: an oversized
`details` is a reporting problem, not a failed webhook. The work the handler did
still succeeded, and saying otherwise would be a lie in the `status` field.
