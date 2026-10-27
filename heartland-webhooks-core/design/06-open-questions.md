# 06 — Open questions

Known gaps in **this package** as of `0.1.0`. Deliberate omissions and unmade
decisions, not bugs. When one is settled it becomes an [ADR](adr/) and the entry
here is deleted.

System-level gaps — durable retry, cross-system idempotency, the scheduled-job
seam, two-way sync — live in the top-level
[design record](../../design/05-open-questions.md).

Ordered by how much damage the gap can do.

## 1. Webhook requests are unauthenticated

Core processes anything that reaches the function URL. A caller who knows (or
guesses) a tenant's path can submit a fabricated `sales_transaction_completed`
body and cause a handler to act on it — including writes back to Heartland, and,
once connectors exist, pushes out to sales channels.

Tenant ids are routing keys, not credentials, and the design currently treats
them that way.

Options, roughly in order of cost:
- A shared secret in a header per tenant, verified before tenant resolution.
- HMAC over the raw body, if Heartland can be configured to sign.
- A long unguessable path segment per tenant (obscurity, not authentication —
  and it lands in CloudWatch via `rawPath`).

Open because it needs a decision on what Heartland's webhook configuration can
actually send.

## 2. The envelope log includes all request headers

`pipeline.ts` logs `event.headers` wholesale, which is genuinely useful for
diagnosis today. It also means that the moment a shared-secret header exists
(item 1), the secret is written to CloudWatch on every invocation.

Fix when item 1 lands: allowlist or redact. The two are coupled and should be
decided together.

## 3. No timeout on outbound HTTP

`requestJson` sets no socket or request timeout. A hung Heartland connection
holds the invocation until the Lambda's own timeout, which produces a less
informative failure and burns the full configured duration.

Low-cost fix (`req.setTimeout` + `req.destroy`); the open part is what the
default should be and whether it is per-call configurable.

## 4. No retry or rate-limit handling

A 429 or a transient 5xx from Heartland fails the webhook outright. Heartland
will not usefully retry, because core answers 200 by design
([ADR-0002](adr/0002-always-200.md)) — so the event is simply lost.

In-process retry with backoff is the cheap version and belongs here. Durable
retry is a system-level decision and does not.

## 5. Process-lifetime token cache has no TTL

`TenantRegistry` memoizes a context for the life of the process. If a token is
rotated, a warm Lambda keeps using the old one until the next cold start, which
surfaces as 401s from Heartland rather than as a cache problem.

Options: a TTL, or invalidating the cached context on a 401 and reloading once.
Open because it has not bitten yet, and because the right fix depends on how
rotation ends up being done.

## 6. `details` is unbounded

A handler's `details` is serialized into the response body with no size limit.
A handler returning a large structure makes every response heavy and every log
line long. Currently convention, not enforcement.

## 7. Tenant resolution cannot read the payload

Every resolver is `(event) => TenantId | undefined` and runs *before* the body
is parsed, so a tenant discriminator available only inside the webhook payload
cannot be used without parsing the body twice.

This is latent rather than live: it only matters if Heartland turns out to allow
neither a per-tenant path nor a custom header on a registered webhook, which is
[unconfirmed and to be settled in testing](01-multi-tenancy.md#resolving-a-tenant-from-a-request).
If it does land there, the fix is a payload-aware resolution step in the
pipeline — parse once, then resolve — not a second parse inside a resolver.

## 8. Reporting responses are untyped

`runReport<T>` defaults to `unknown` and the caller supplies the shape. Fine
while report usage is thin; if reports become load-bearing for automations they
deserve the same partial-model treatment as the rest of `heartland-types.ts`.
