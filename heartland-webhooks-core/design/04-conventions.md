# 04 — Conventions

Standing decisions. These are the patterns to follow when adding code, and the
ones to point at in review.

## Errors: three tiers

Which mechanism to use depends on whether the condition is routine, local, or a
programming error.

**Routine and expected → a result value.** Webhook parsing returns
`ParseResult<T>`, never throws. A malformed body is something Heartland can
legitimately send; it is to be logged and answered, not unwound through the
Lambda entrypoint (`src/parsing/result.ts`).

```ts
const parsed = parseTransactionBody(body);
if (!parsed.ok) { /* parsed.error is a human-readable string */ }
```

**Operational → throw, and let the pipeline contain it.** Token loads, Heartland
calls, and handler bodies throw normally. The pipeline catches at exactly two
points — `registry.context()` and `invoke()` — turns the throw into
`status: "error"` with a `reason`, and still answers 200. Containment lives in
one file so no handler has to implement it.

**Misconfiguration → throw at construction.** Duplicate tenant ids, zero
tenants, multiple tenants with no resolver. These fail at cold start, which is
the cheapest place to discover them.

Error messages name the thing that is wrong and what was expected:
`Unknown tenant "x"; known tenants: a, b`. Interpolating the known set costs
nothing and removes a round of guessing from diagnosis. Never swallow and
`return undefined` where the caller cannot distinguish absence from failure.

## Logging

Use the `Logger` interface, never `console` directly — outside `ConsoleLogger`,
which is its one implementation.

| Level | Use for |
| --- | --- |
| `debug` | Per-line / per-item tracing. Suppressed unless `debugEnabled` |
| `info` | One line per lifecycle milestone: received, handling, handled |
| `warn` | Ignored events — nothing to do, no action needed |
| `error` | Failures someone should look at |

Derive, don't re-tag: `logger.child('heartland-api')` appends, producing
`[clutch][bamherndon][heartland-api]`. Pass structured detail as the second
argument rather than interpolating it into the message, so `safeStringify`
handles `Error` stacks and circular structures.

`debug` existing as a suppressed level is deliberate: the verbose receipt and
inventory tracing stays in the code permanently, instead of being added and
deleted each time something needs diagnosing.

## Parsing untrusted JSON

Use the accessors in `src/parsing/json.ts` rather than casts. Each `getX`
returns `undefined` for an absent or wrong-typed field.

The `OrNull` variants exist because **Heartland distinguishes "not sent" from
"sent as null"** on several item fields. `getNumberOrNull` preserves an explicit
`null` while still rejecting a wrong type. If the distinction does not matter
for a field, use the plain variant; do not reach for `OrNull` by default.

Validation is minimal on purpose: a parser checks what the pipeline needs to
route and log — in practice a numeric `id` — and passes the rest through. Both
payload models carry an index signature, so a handler can read a field Heartland
added last week without waiting for core to model it. Deep validation of fields
only one tenant cares about belongs in that tenant's handler.

### Custom fields

`HeartlandItemCustomFields` is the **one definition** of the BAM-mandated custom
fields, and it lives here so every module shares it. Add a field to it rather
than reaching into `custom` with a string literal somewhere downstream — the
reasoning is in
[ADR-0005](../../design/adr/0005-assume-bam-item-schema.md) and
[invariant 8](../../design/03-invariants.md).

The fields are modelled as optional, and that is not pessimism about the
corporate mandate: a mandated field can still be blank on an individual item.
Code that needs one checks and reports, rather than assuming.

The index signature stays so a store's own extra custom fields remain reachable
without being modelled.

### Naming across the boundary

Two deliberately different conventions:

- **Webhook payloads are normalized.** `parseItemCreatedBody` maps Heartland's
  `snake_case` and its trailing-`?` boolean convention (`allow_fractional_qty?`)
  onto camelCase. Handlers see idiomatic TypeScript.
- **REST client types are not.** `src/clients/heartland-types.ts` keeps
  `snake_case` verbatim, because those objects are also *sent back* to Heartland
  (`updateInventoryItem(id, updates)`), and translating in both directions would
  invite field-name drift.

The one exception in the transaction model is `'completed?'`, quoted as a
literal Heartland field name — the transaction parser is a pass-through, so the
wire name survives. `summarizeTransaction` surfaces it as `completed_flag` for
logs.

## Public surface

`src/index.ts` is the whole contract. A symbol re-exported there is public and
changing it is a breaking change; a symbol that is not is internal.

`createWebhookLambda` and `WebhookPipeline` are internal on purpose — they are
the extension seam for core's own maintainers, not for consumers. A consumer
adding an event type should add a factory to core rather than assembling a
pipeline from outside.

## TypeScript

`strict: true`, targeting ES2020 / CommonJS for Node on Lambda. Declarations and
source maps are emitted (`dist/`), so a consumer stepping into core sees real
source. `types` is pinned to `node`, `aws-lambda`, `jest` rather than ambient
everything.

Prefer interfaces for contracts a caller implements (`Logger`,
`HeartlandApiClient`, `TransactionHandler`), type aliases for unions and
function types (`TenantResolver`, `ParseResult`, `TransactionKind`). Reach for
generics only where a type genuinely must stay agnostic of the handler:
`WebhookPipeline<TPayload, THandler>` does, because one lifecycle serves both
event types. `TenantRegistry` deliberately does **not** — it maps a tenant id to
a context and never touches a handler, so parameterizing it by handler type
would be noise that also implied a per-tenant handler.

`aws-lambda` is a devDependency — types only, never imported at runtime.

## Testing

`tests/` mirrors `src/` one directory per layer. Jest + ts-jest, coverage
collected on every run (`npm test` ⇒ `jest --coverage`), with `src/index.ts`
excluded from coverage since it is only re-exports.

- **No network, no AWS.** Substitute a client with `clientFactory`, a token with
  `getToken: async () => 'token'`, and logging with `NoopLogger`.
- **Build the event with `tests/helpers/event.ts`.** `makeEvent(overrides)`
  populates only the fields core reads; `bodyOf(result)` parses the response.
- **Assert on `status`, not on `statusCode`.** The status code is always 200;
  `status` is the field the response contract documents as stable.
- **Recording fakes over mock frameworks.** The existing lambda tests use small
  hand-written handler classes that record their calls and can be configured to
  return an outcome or throw — readable, and they type-check against the real
  interface.

`npm run build` is `lint && test && tsc`: a package that does not lint or pass
its tests does not produce a `dist/`.

## Lint

Flat ESLint config, typed linting for `src/**` (uses `tsconfig.json`) and
untyped for `tests/**`. `no-console` is off — `ConsoleLogger` needs it, and
CloudWatch captures it. Unused args are allowed when prefixed `_`, which is how
`NoopLogger`'s no-op methods satisfy the interface.

## Comments

Comment the *why*, not the *what*. The existing code is the reference: the
comment on the context cache explains why failures are not cached; the one on
tenant resolution explains why it happens before parsing; the one on
`webhookResponse` explains why 200 is unconditional. None of them restate the
code beneath them.

Document a constraint at the place it bites. `createReceiptFromPurchaseOrder`
says why PO lines without an `item_id` are skipped, because nothing about the
endpoint reveals it.
