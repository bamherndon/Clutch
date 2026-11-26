# ADR-0009 — Log every header's name, but only allowlisted values

**Status:** Accepted · **Date:** 2026-11-26

Settles the header-logging gap (formerly open question 2).

## Context

The envelope log in `pipeline.ts` emits `event.headers` wholesale. That is
genuinely useful right now: nobody has yet confirmed what Heartland actually
sends on a registered webhook, and the envelope log is the instrument for
finding out.

It is also a standing liability. Whatever authentication scheme eventually wins
for open question 1 — a shared-secret header, a signature — the credential
arrives in a header, and today it would be written to CloudWatch on every
invocation. The original entry said to decide this *with* item 1. That was
wrong: the safe shape is the same whichever scheme wins, so it can be settled
now and does not need to wait.

## Decision

**Log the name of every header. Log the value of allowlisted headers only.**

- Names of all headers are emitted — unknown names are diagnostic and carry no
  secret.
- Values are emitted for a fixed allowlist: `content-type`, `content-length`,
  `user-agent`, and the AWS trace header.
- Any header used to carry a credential is never in the allowlist. Its
  *presence* may be logged — "signature header present: true" is useful and
  reveals nothing.
- Extending the allowlist is a deliberate edit, so opting a value in is a
  visible decision rather than a default.

## Consequences

- The envelope log is safe before any auth scheme exists, so adding one later
  does not require remembering to tighten logging at the same time.
- Diagnosing an unexpected Heartland header costs one extra step: the name
  appears, and reading its value means opting it in on purpose.
- **Sequencing matters.** The probe that answers open question 1 relies on
  seeing what Heartland sends. Either run that probe before this lands, or
  temporarily allowlist what it needs — knowingly, in a non-production
  deployment.
- One more thing the pipeline must do on a path where everything else is a
  branch. The filtering belongs in the envelope-logging step and nowhere else.

## Alternatives considered

**Redact a denylist of known-sensitive names** (`authorization`, `cookie`, …).
Rejected: a denylist fails open. The header that leaks is the one nobody thought
to list, which in this design is a header we have not invented yet.

**Log nothing about headers.** Safest, and it throws away the only evidence of
what Heartland sends. Rejected — it would make open question 1's probe harder
than it needs to be.

**Keep full logging until auth exists.** The entry's original plan. Rejected: it
couples two decisions that do not need to be coupled and leaves a window where
the secret is live and the log is still wide open.
