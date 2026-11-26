# 06 — Open questions

Known gaps in **this package**. Deliberate omissions and unmade decisions, not
bugs. When one is settled it becomes an [ADR](adr/) and the entry here is
deleted.

System-level gaps — durable retry, cross-system idempotency, the scheduled-job
seam, two-way sync — live in the top-level
[design record](../../design/05-open-questions.md).

One entry remains. It is the only gap in this package blocked on a **fact**
rather than a decision.

## 1. Webhook requests are unauthenticated

Core processes anything that reaches the function URL. A caller who knows (or
guesses) a tenant's path can submit a fabricated `sales_transaction_completed`
body and cause a handler to act on it — including writes back to Heartland, and,
once connectors exist, pushes out to sales channels.

Tenant ids are routing keys, not credentials
([ADR-0011](adr/0011-tenant-id-required-in-webhook-url.md) makes the id required,
which is routing, not authentication).

What blocks the decision: **what a Heartland webhook registration can be
configured to send.** The public API reference lists `/api/webhooks`
create/retrieve/search/update/delete operations but does not document the
configuration fields, so the answer has to come from the API itself.

### The probe that unblocks it

1. `POST /api/webhooks` against a non-production instance, attempting a custom
   header and a secret/signing field. Record which fields the API accepts versus
   silently drops.
2. `GET` the created webhook and compare — an accepted field is not necessarily
   a persisted one.
3. Trigger a real event and read the envelope log for the header names received,
   and confirm `rawPath` arrives with the registered tenant segment intact. That
   second half verifies ADR-0011's registration scheme; the fallback if it does
   not hold is a Function URL per tenant, not a change to resolution.
4. Note whether anything describes retry or auto-disable behaviour. That is the
   premise [ADR-0002](adr/0002-always-200.md) rests on, and it is currently
   taken on trust.

The envelope log is the instrument for steps 3 and 4, so run this **before**
tightening it per [ADR-0009](adr/0009-log-header-names-allowlist-values.md), or
allowlist what the probe needs in a non-production deployment.

### What each outcome implies

| Heartland supports | Decision |
| --- | --- |
| Signing over the body | Verify the signature before tenant resolution. Strictly best: it authenticates the payload, not just the sender. |
| A custom header | Per-tenant shared secret, verified before resolution. Never logged ([ADR-0009](adr/0009-log-header-names-allowlist-values.md)). |
| Neither | Authentication cannot be done at this layer. Escalate to the system level — the options then are network-level (a shared secret in the path, accepted as obscurity) or fronting the function with something that can authenticate. |

## Settled

| Was | Now |
| --- | --- |
| No timeout; no retry | [ADR-0007](adr/0007-outbound-http-timeouts-and-retries.md) |
| Token cache has no TTL | [ADR-0008](adr/0008-reload-context-on-401.md) |
| All request headers logged | [ADR-0009](adr/0009-log-header-names-allowlist-values.md) |
| `details` unbounded | [ADR-0010](adr/0010-bound-outcome-details.md) |
| Resolution cannot read the payload | [ADR-0011](adr/0011-tenant-id-required-in-webhook-url.md) — it does not need to |
| Reporting responses untyped | [ADR-0012](adr/0012-report-shapes-belong-to-the-caller.md) — correct as it is |

ADRs 0007–0010 are decided but **not yet implemented**; each states what the
code does today. 0011 and 0012 describe the design as it already stands.
