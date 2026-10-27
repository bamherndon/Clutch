# ADR-0004 — Core ships zero runtime dependencies

**Status:** Accepted · **Date:** 2026-10-26

## Context

`heartland-webhooks-core` runs on AWS Lambda and does three things that usually
pull in packages: HTTPS+JSON requests, UUID generation, and secret loading.
The conventional choices would be `axios` or a `fetch` polyfill, `uuid`, and
`@aws-sdk/client-secrets-manager`.

Lambda cares about bundle size for cold starts, and a long-lived integration
cares about not inheriting the upgrade treadmill and vulnerability surface of
transitive dependency trees.

## Decision

`dependencies` in `heartland-webhooks-core/package.json` is empty and stays
empty. Everything comes from the Node standard library or from a caller:

| Need | Source |
| --- | --- |
| HTTPS + JSON | `node:https`, in the single `requestJson` helper |
| UUID for reporting requests | `node:crypto` → `crypto.randomUUID()` |
| Secret loading | **injected** by the caller as `getToken()` — see [ADR-0005](0005-injected-token-loading.md) |
| Lambda event types | `@types/aws-lambda`, a **devDependency** — types only, never imported at runtime |
| Logging | the `Logger` interface; `ConsoleLogger` writes to `console`, which CloudWatch captures |

Dev tooling (TypeScript, Jest, ESLint) is unconstrained — it does not ship.

Downstream modules (handlers, infrastructure) are free to take dependencies.
This constraint applies to core only.

## Consequences

- The published `dist/` is small, with no transitive tree to audit or upgrade,
  and no dependency can break a cold start.
- No AWS SDK import means core is runnable and testable outside AWS, which is
  what makes the test suite network-free.
- Having exactly one HTTP call site is a direct consequence: writing a second
  raw `https.request` by hand would be tedious enough that the shared helper
  wins by default. Uniform auth handling and error text fall out of that.
- Costs, accepted knowingly:
  - `requestJson` is hand-rolled, so timeouts and retries are features we must
    build rather than configure. Both are currently missing — open questions
    [3 and 4](../06-open-questions.md).
  - No streaming, no multipart, no connection pooling beyond Node's default
    agent. None are needed for JSON APIs at webhook volumes.
- A proposal to add a runtime dependency to core needs an ADR superseding this
  one.

## Alternatives considered

**`axios` or `node-fetch`.** Timeouts, interceptors, and retry handlers for free.
Rejected: ~200 lines of hand-written transport is a smaller long-term liability
than a dependency tree for a package whose entire network surface is one JSON
API.

**Global `fetch` (Node 18+).** Tempting, and would remove most of `http.ts`.
Rejected for now because `https.request` keeps behaviour pinned across Lambda
runtime upgrades and makes `https`-level stubbing in tests straightforward.
Worth revisiting when the Node floor rises.

**AWS SDK in core for secret loading.** Rejected — see
[ADR-0005](0005-injected-token-loading.md); it would also be the single largest
contributor to bundle size.
