# ADR-0006 — A webhook is a trigger; the API is the source of truth

**Status:** Accepted · **Date:** 2026-11-26

Closes the request-authentication gap (formerly open question 7 at this level,
and open question 1 in `heartland-webhooks-core`).

## Context

Clutch cannot authenticate an inbound webhook. Heartland's webhook registration
is not documented to support a shared secret, a signed body, or a custom header,
and the options it does offer are thin. So anything that reaches the endpoint
has to be treated as having come from anywhere.

The previous framing treated this as a question to answer — find the
authentication mechanism, then trust the payload. That search may not have an
answer. Meanwhile the payload was being used as *data*: parsed, normalized, and
handed to a handler that acted on its contents. A forged body could therefore
assert a sale that never happened, and a handler would act on it.

## Decision

**Do not trust the payload. Use the webhook as a trigger and read the
authoritative record from the Heartland API.**

- Core extracts only what it needs to route: the record id, the event type, and
  the tenant (from the URL — [ADR-0011 in core](../../heartland-webhooks-core/design/adr/0011-tenant-id-required-in-webhook-url.md)).
- Core then fetches that record from the Heartland API **using our own
  credentials**. That response, not the webhook body, is what flows onward.
- The fetch doubles as validation: an id that does not resolve is an invalid
  trigger, and the event is rejected without ever reaching a handler. Invalid
  input fails fast, at the edge, before anything is enqueued.
- Nothing downstream of the receiver ever sees the webhook body.

**Availability, not authenticity, is what throttling protects.** Since anyone
can call the endpoint, the remaining exposure is load. Lambda function URLs do
support throttling, so this needs no API Gateway:

- **Reserved concurrency** caps concurrent invocations, and the effective
  request ceiling is 10× that number; requests beyond it get HTTP 429. Setting
  reserved concurrency to zero is an emergency off switch.
- **CloudFront with AWS WAF in front** adds per-IP rate-based rules. WAF cannot
  attach to a function URL directly, which is the reason to front it.

## Consequences

- **A forged body can no longer inject false data.** The worst a fabricated
  trigger achieves is to make us re-read a record that really exists.
- **Replay is not solved.** A trigger carrying a *real* id causes a real record
  to be reprocessed. That is a much smaller hole than injection, but it is a
  hole, and it means handler idempotency is now mandatory rather than advisory —
  see [ADR-0007](0007-asynchronous-processing-with-dlqs.md) and
  [03 — Invariants](../03-invariants.md).
- **Staleness and ordering largely take care of themselves.** Because the record
  is read at processing time rather than taken from the event, an out-of-order or
  delayed trigger still yields current truth. What remains is concurrency: two
  triggers for the same record, processed at once, can both read-then-write.
- **Every event now costs an API call**, on the synchronous path, before we can
  answer. That is the price of validation at the edge, and it is what forces the
  receiver's retry budget to be small
  ([ADR-0007](0007-asynchronous-processing-with-dlqs.md)).
- **Heartland becomes a hard dependency of *receiving*,** not just of acting. If
  the API is down, triggers cannot be validated — which is why a failed fetch
  goes to a dead-letter queue rather than being dropped.
- **The webhook payload models become envelopes.** `HeartlandItemCreatedPayload`
  and friends are now parsed only far enough to extract an id; the rich
  camelCase normalization of the full body no longer feeds anything. Handlers
  consume the API's representation instead.
- **Throttling has a sharp edge worth naming:** a reserved-concurrency cap
  returns 429 to *whoever* is over the line, including Heartland. Since
  Heartland is understood to disable endpoints that keep failing
  ([ADR-0002 in core](../../heartland-webhooks-core/design/adr/0002-always-200.md)),
  a successful flood could convert a denial of service into a disabled webhook.
  Per-IP limiting at CloudFront/WAF discriminates where a global concurrency cap
  cannot, which makes it the better primary defence and the concurrency cap the
  backstop.
- Tenant ids in the URL remain routing keys, not credentials. Nothing here makes
  them secret, and nothing should start treating them as if they were.

## Alternatives considered

**Keep hunting for an authentication mechanism.** Still worth doing — the probe
is cheap and signing would be strictly better, authenticating the *payload*
rather than just the sender. Rejected as a prerequisite: the trust model above
is sound even if signing never arrives, and waiting would block the design on a
vendor capability we do not control.

**Trust the payload, protect the endpoint with an unguessable URL.** Rejected:
that is obscurity, it leaks into every log line that records `rawPath`, and a
single leaked URL restores full injection.

**Front everything with API Gateway for its native throttling.** Rejected as
unnecessary: function URLs throttle via reserved concurrency, and per-IP rules
need CloudFront/WAF regardless of what sits behind them. It would also cost the
reason `fromPathSegment` is core's default resolver.

**Accept the payload but validate it against the API** — compare the two and act
on the body if they agree. Rejected: if the API is being read anyway, the body
adds nothing but a second shape to maintain and a disagreement case to resolve.
