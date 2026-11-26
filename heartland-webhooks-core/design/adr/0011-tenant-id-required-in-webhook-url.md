# ADR-0011 — The tenant id is a required path segment of the webhook URL

**Status:** Accepted · **Date:** 2026-11-26

Closes the payload-resolution gap (formerly open question 2, and open question 7
before that).

## Context

The pipeline has to attribute a request to a tenant before it can do anything
else. Core ships several resolvers, and the docs named `fromPathSegment(0)` the
default while also recording that "whether Heartland actually permits a
per-tenant path on a registered webhook URL is unconfirmed".

That framing was wrong in a way worth naming: **we register the URL.** It is our
own Lambda Function URL, and a Function URL routes every path to the same
function and delivers the full path in `rawPath`. There is no route table to
configure and no path to reserve. The tenant segment is therefore not a
capability we hope Heartland offers — it is a convention we impose on ourselves
at registration time.

Treating it as an external unknown left a second question alive downstream: if
no header and no path were available, resolution would have to read the parsed
body, which would invert the pipeline's deliberate "tenant before parse"
ordering.

## Decision

**Every webhook is registered against a URL carrying its tenant, and that
segment is required rather than conventional:**

```
https://<fn-url>/<tenantId>/<event>
e.g. https://abc123.lambda-url.us-east-1.on.aws/bamherndon/transaction
```

- `fromPathSegment(0)` stays the default resolver.
- Registering a webhook URL without a tenant segment is a deployment error. The
  invariant is enforced where the URL is constructed — in the deployment module,
  alongside the registration itself — because that is the only place that knows
  the URL.
- **If Heartland turns out to reject a path on the registered URL**, the
  fallback is a Function URL per tenant with `fixedTenant(id)`. The tenant stays
  structurally required; it just moves from the path to the deployment's
  identity.
- Payload-based resolution is explicitly **not** the fallback.

## Consequences

- The tenant id is present in every request, before the body is touched, so the
  pipeline's "tenant before parse" ordering stands and an unroutable request is
  still reported as the configuration problem it is.
- Adding a tenant is a registration plus a `TenantConfig` entry. No code change.
- A missing or wrong segment already fails loudly: `could not resolve a tenant`
  or `unknown tenant "x"`, both carrying `rawPath` and the registered ids, which
  is exactly the diagnostic a mis-registered webhook needs.
- The tenant id is visible in the URL and in CloudWatch. That is fine — it is a
  routing key, not a credential. Authentication is a separate, still-open
  question, and nothing here should be read as providing it.
- `fromHeader`, `fromQueryString`, and `firstOf` stay in the package. They cost
  nothing, they make the resolver seam honest, and `firstOf` is the migration
  path if the scheme ever changes.
- One consequence to accept: the registered URL is now load-bearing
  configuration. It is reviewed as part of deployment, not discovered at
  runtime.

## Alternatives considered

**A custom header** (`x-clutch-tenant`). Works if Heartland supports custom
headers — still unconfirmed — and adds a second thing to get right at
registration. Rejected as the default because the path needs no capability from
Heartland at all. Kept as a resolver for the same reason.

**A query-string parameter.** Equivalent in power, easier to drop by accident
when editing a URL, and no less visible in logs. Rejected.

**Reading the tenant from the parsed payload.** Rejected: it would require
parsing before resolving, which inverts the ordering that makes an unroutable
request diagnosable, and it would couple tenancy to each event type's schema.
This ADR exists largely to take it off the table.

**One Lambda per tenant, single-tenant each.** The fallback, and also the lever
for per-tenant blast-radius isolation if that is ever wanted. Rejected as the
default because it multiplies deployments for a problem a path segment solves.
