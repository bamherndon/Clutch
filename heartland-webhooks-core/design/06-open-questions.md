# 06 — Open questions

Known gaps in **this package**. Deliberate omissions and unmade decisions, not
bugs. When one is settled it becomes an [ADR](adr/) and the entry here is
deleted.

System-level gaps — durable retry, cross-system idempotency, the scheduled-job
seam, two-way sync — live in the top-level
[design record](../../design/05-open-questions.md).

Six entries were settled on 2026-11-26 as
[ADR-0007](adr/0007-outbound-http-timeouts-and-retries.md) (timeouts, retry),
[ADR-0008](adr/0008-reload-context-on-401.md) (token rotation),
[ADR-0009](adr/0009-log-header-names-allowlist-values.md) (header logging), and
[ADR-0010](adr/0010-bound-outcome-details.md) (`details` size). What follows is
what genuinely remains.

## 1. Webhook requests are unauthenticated

Core processes anything that reaches the function URL. A caller who knows (or
guesses) a tenant's path can submit a fabricated `sales_transaction_completed`
body and cause a handler to act on it — including writes back to Heartland, and,
once connectors exist, pushes out to sales channels.

Tenant ids are routing keys, not credentials, and the design currently treats
them that way.

This is the only gap in this package that is blocked on a fact rather than a
decision: **what a Heartland webhook registration can be configured to send.**
The public API reference lists `/api/webhooks` create/retrieve/search/update/
delete operations but does not document the configuration fields, so the answer
has to come from the API itself.

### The probe that unblocks it

1. `POST /api/webhooks` against a non-production instance, attempting a custom
   header, a secret/signing field, and a URL carrying a tenant path segment.
   Record which fields the API accepts versus silently drops.
2. `GET` the created webhook and compare — an accepted field is not necessarily
   a persisted one.
3. Trigger a real event and read the envelope log: the received header names,
   and whether `rawPath` arrives with the registered path segment intact.
4. Note whether anything in the response or docs describes retry or
   auto-disable behaviour, which is the assumption
   [ADR-0002](adr/0002-always-200.md) rests on.

The envelope log is the instrument for steps 3 and 4, so run this **before**
tightening it per [ADR-0009](adr/0009-log-header-names-allowlist-values.md), or
allowlist what the probe needs in a non-production deployment.

### What each outcome implies

| Heartland supports | Auth decision | Effect on item 2 |
| --- | --- | --- |
| Signing over the body | Verify the signature before tenant resolution. Strictly best. | Closed — resolution can stay header- or path-based |
| A custom header | Per-tenant shared secret, verified before resolution | Closed |
| URL only | Auth must come from an unguessable path, which is obscurity, not authentication — escalate to the system level | **Live** — see item 2 |

## 2. Tenant resolution cannot read the payload

Every resolver is `(event) => TenantId | undefined` and runs *before* the body
is parsed, so a tenant discriminator available only inside the webhook payload
cannot be used without parsing the body twice.

Latent rather than live: it only matters if the probe above finds that Heartland
allows neither a per-tenant path nor a custom header, which is
[unconfirmed](01-multi-tenancy.md#resolving-a-tenant-from-a-request). If it does
land there, the fix is a payload-aware resolution step in the pipeline — parse
once, then resolve — and **not** a second parse inside a resolver.

Note this would invert the pipeline's current "tenant before parse" ordering,
which exists so an unroutable request is reported as itself rather than as a
parse error. Reordering is the real cost here, not the resolver signature.

## 3. Reporting responses are untyped

`runReport<T>` defaults to `unknown` and the caller supplies the shape. Fine
while report usage is thin; if reports become load-bearing for automations they
deserve the same partial-model treatment as the rest of `heartland-types.ts`.

Deliberately still open: modelling a report before an automation depends on it
would be guessing at which fields matter.
