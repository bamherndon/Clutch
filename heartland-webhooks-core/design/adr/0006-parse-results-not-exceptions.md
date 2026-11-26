# ADR-0006 — Parsers return results instead of throwing

**Status:** Accepted · **Date:** 2026-10-26

## Context

Webhook bodies arrive as untrusted strings. They can be invalid JSON, a JSON
array instead of an object, or an object missing the `id` that routing and
logging depend on. None of these are surprising — they are a normal consequence
of being an HTTP endpoint.

Separately, Heartland's payloads are larger than the fields Clutch models, use
`snake_case`, use a trailing-`?` convention for booleans
(`allow_fractional_qty?`), and distinguish "field absent" from "field sent as
null" on several item fields.

## Decision

**Parsers never throw.** They return a discriminated union:

```ts
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
```

The pipeline branches on `parsed.ok`, logs the raw body, and answers with
`status: "error"` and a reason. A malformed body is a routine condition to log
and answer, not an exception to unwind through the Lambda entrypoint.

**Validation is minimal.** A parser checks what the pipeline needs in order to
route and log — in practice a numeric `id` — and passes everything else through.
Both payload models carry an index signature, so unmodelled Heartland fields
stay reachable without a cast.

**Reading untrusted fields goes through typed accessors** (`src/parsing/json.ts`)
rather than casts. `getString`, `getNumber`, `getBoolean`, `getRecordOrNull`,
and the `OrNull` variants each return `undefined` for an absent or wrong-typed
field; the `OrNull` variants preserve an explicit `null`, because Heartland's
distinction between "not sent" and "sent as null" is meaningful.

The two parsers differ in how far they go, deliberately:

- `parseTransactionBody` validates `id` and **passes the payload through**. The
  transaction fields we care about arrive at the top level and the rest is kept
  verbatim.
- `parseItemCreatedBody` **normalizes** the whole item to camelCase field by
  field, including nested `custom` fields, because the item payload's naming is
  hostile to read from a handler.

## Consequences

- The entrypoint has no try/catch around parsing, and parse failures are
  reported with the same vocabulary as every other failure.
- Parsers are pure, synchronous, and trivially testable: string in, result out,
  no logging and no I/O.
- An unparseable body logs the raw body at `error` level, which is what makes an
  unexpected Heartland payload change diagnosable.
- Index signatures mean a handler can read a field Heartland added last week
  without waiting for core to model it — at the cost of no compile-time
  guarantee that the field exists. That trade is accepted: deep validation of a
  field only one tenant cares about belongs in that tenant's handler.
- Two naming conventions coexist in the codebase (normalized camelCase for
  webhook payloads, verbatim `snake_case` for REST client types). That is
  intentional and documented in [04 — Conventions](../04-conventions.md#naming-across-the-boundary):
  client types are also sent *back* to Heartland, so translating them in both
  directions would invite field-name drift.

## Alternatives considered

**Throw on invalid input, catch in the entrypoint.** Fewer types. Rejected: it
makes a routine condition indistinguishable from a bug at the catch site, and
`ParseResult` carries a message the response can use directly.

**A schema validator (zod, ajv).** Better guarantees and less hand-written
mapping. Rejected: it is a runtime dependency ([ADR-0004](0004-zero-runtime-dependencies.md)),
and strict schemas reject payloads for unmodelled fields — exactly the
brittleness the index signatures exist to avoid when Heartland adds a field.

**Trust the payload and cast.** Rejected: the first malformed body becomes a
`TypeError` from inside a handler, attributed to the wrong layer.
