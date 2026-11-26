# 06 — Open questions

Known gaps in **this package**. Deliberate omissions and unmade decisions, not
bugs. When one is settled it becomes an [ADR](adr/) and the entry here is
deleted.

System-level gaps — identity mapping, idempotency, reconciliation, the
scheduled-job seam, two-way sync — live in the top-level
[design record](../../design/05-open-questions.md).

**Nothing on this list blocks work in this package.** The authentication
question that did is answered at the system level: the payload is no longer
trusted, so there is nothing to authenticate it *for*
([ADR-0006](../../design/adr/0006-webhook-is-a-trigger-api-is-truth.md)).

## 1. Whether Heartland can sign or authenticate a webhook — still worth knowing

Not a blocker any more, and still the probe most worth running. Signing would
authenticate the *payload* rather than just the sender, which would close the
replay exposure that
[ADR-0006](../../design/adr/0006-webhook-is-a-trigger-api-is-truth.md) leaves
open: a forged trigger carrying a real record id still causes a real record to
be reprocessed.

The public API reference lists `/api/webhooks` create/retrieve/search/update/
delete operations but does not document the configuration fields, so the answer
has to come from the API itself.

### The probe

1. `POST /api/webhooks` against a non-production instance, attempting a custom
   header and a secret/signing field. Record which fields the API accepts versus
   silently drops.
2. `GET` the created webhook and compare — an accepted field is not necessarily
   a persisted one.
3. Trigger a real event and read the envelope log for the header names received,
   and confirm `rawPath` arrives with the registered tenant segment intact. That
   second half verifies
   [ADR-0011](adr/0011-tenant-id-required-in-webhook-url.md)'s registration
   scheme; the fallback if it does not hold is a Function URL per tenant, not a
   change to resolution.
4. Note whether anything describes retry or auto-disable behaviour. That is the
   premise [ADR-0002](adr/0002-always-200.md) rests on, and it is currently taken
   on trust. It matters less than it did — a failed event now lands in a
   dead-letter queue rather than being lost — but the premise is still load-
   bearing for the decision to answer 200 at all.

The envelope log is the instrument for steps 3 and 4, so run this **before**
tightening it per [ADR-0009](adr/0009-log-header-names-allowlist-values.md), or
allowlist what the probe needs in a non-production deployment.

### If signing exists

Verify it in the receiver, before anything else, and keep reading the record from
the API anyway. The two are complementary: a signature says the trigger is
genuine, the API read says the data is current. Dropping the API read would also
give up the id validation that makes an invalid trigger fail at the edge.

## Settled

| Was | Now |
| --- | --- |
| No timeout | [ADR-0007](adr/0007-outbound-http-timeouts-and-retries.md) |
| No retry | [ADR-0007](adr/0007-outbound-http-timeouts-and-retries.md), amended by the [async split](../../design/adr/0007-asynchronous-processing-with-dlqs.md) |
| Token cache has no TTL | [ADR-0008](adr/0008-reload-context-on-401.md) |
| All request headers logged | [ADR-0009](adr/0009-log-header-names-allowlist-values.md) |
| `details` unbounded | [ADR-0010](adr/0010-bound-outcome-details.md) |
| Resolution cannot read the payload | [ADR-0011](adr/0011-tenant-id-required-in-webhook-url.md) — it does not need to |
| Reporting responses untyped | [ADR-0012](adr/0012-report-shapes-belong-to-the-caller.md) — correct as it is |
| Requests unauthenticated | [ADR-0006 at the system level](../../design/adr/0006-webhook-is-a-trigger-api-is-truth.md) — stop trusting the payload |

ADRs 0007–0010 are decided but **not yet implemented**; each states what the
code does today. 0011 and 0012 describe the design as it already stands. The
asynchronous rework that supersedes parts of several of them is also not
implemented — see
[02 — Webhook pipeline](02-webhook-pipeline.md) for what the code does now.
