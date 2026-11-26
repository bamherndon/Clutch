# 06 — Open questions

**None at the package level.**

That is not a claim of completeness — it means every unresolved question that
touches this package is a system-level one, recorded in the top-level
[design record](../../design/05-open-questions.md) where its decision will be
made. The register stays here so there is a place for the package's own gaps
when it accrues them again, which the asynchronous rework will.

What this package used to list, and where it went:

- **Timeouts, retries, token rotation, header logging, `details` size, payload
  resolution, report typing** — all settled as ADRs. See
  [the decisions index](README.md#decisions); each ADR states what the code does
  today versus what was decided.
- **Requests are unauthenticated** — answered at the system level by not
  trusting the payload
  ([ADR-0006](../../design/adr/0006-webhook-is-a-trigger-api-is-truth.md)).
  There is nothing left to authenticate it *for*.
- **Whether Heartland can sign a webhook** — still worth knowing, and now a
  system-level question: it bounds the replay exposure ADR-0006 leaves open, not
  anything this package decides. Tracked as
  [issue #12](https://github.com/bamherndon/Clutch/issues/12), which carries the
  probe steps, and as item 4 of the
  [system-level open questions](../../design/05-open-questions.md).

Two premises this package rests on are unverified rather than undecided, which
is why they are not listed as questions. Both are checked by
[issue #12](https://github.com/bamherndon/Clutch/issues/12):

- `rawPath` arrives carrying the registered tenant segment
  ([ADR-0011](adr/0011-tenant-id-required-in-webhook-url.md)).
- Heartland disables endpoints that keep failing
  ([ADR-0002](adr/0002-always-200.md)) — the reason for answering 200 at all.
