# 05 — Extending core

Three kinds of change, in increasing order of how much they touch core.

## 1. Write a handler

The common case. A handler implements one interface, lives outside core, and
serves every tenant — tenancy arrives as the `TenantContext` argument.

```ts
import {
  TransactionHandler, HeartlandTransaction, TransactionKind,
  TenantContext, WebhookOutcome,
} from 'heartland-webhooks-core';

export class BamTransactionHandler implements TransactionHandler {
  readonly name = 'bam-herndon-sales';

  constructor(private readonly groupMe: GroupMeClient) {}

  // Optional. Returning false reports the webhook as `ignored`.
  supports(_tx: HeartlandTransaction, kind: TransactionKind): boolean {
    return kind === 'sale';
  }

  async handleTransaction(
    tx: HeartlandTransaction,
    { heartland, logger }: TenantContext,
  ): Promise<WebhookOutcome> {
    const lines = await heartland.getTicketLines(tx.id);
    logger.info(`Checking ${lines.results.length} lines`);
    // …business logic…
    return { ok: true, details: { linesChecked: lines.results.length } };
  }
}
```

Then register it once, alongside the tenants it serves:

```ts
export const handler = createTransactionLambda({
  handler: new BamTransactionHandler(groupMe),   // one instance, every tenant
  tenants: [
    { tenantId: 'bamherndon', baseUrl: herndonUrl,
      getToken: () => loadToken('bamherndon') },
    { tenantId: 'bamreston', baseUrl: restonUrl,
      getToken: () => loadToken('bamreston') },
  ],
  resolveTenant: fromPathSegment(0),   // required once there are two tenants
});
```

`tenants` is configuration only. `getToken` may be omitted for a tenant whose
handler never calls Heartland back — see
[01 — Multi-tenancy](01-multi-tenancy.md#tenants-without-credentials).

### Rules for handler authors

- **Never read tenant configuration from `process.env`.** Take the base URL, the
  client, and the logger from `TenantContext`. Non-tenant-varying config
  (feature flags, a shared API key for an outbound service) may come from the
  environment or the constructor.
- **Use `context.heartland`, never construct a client.** The context's client is
  the only one guaranteed to be pointed at the right store.
- **Log through `context.logger`.** It is already tagged with the tenant.
- **Return `details` for anything an operator would want to see.** It is echoed
  verbatim into the response body and is the cheapest observability available.
  Keep it small; it is serialized on every invocation.
- **Throwing is acceptable.** The pipeline logs it with a stack and reports
  `status: "error"` while still answering 200. Throw when the work genuinely
  failed; return `{ ok: false, details }` when you want to report a controlled
  failure with structure.
- **Hold no per-tenant state.** One instance serves every tenant. Constructor
  dependencies are for things identical across stores; anything that varies
  comes from `TenantContext`.
- **Make `supports()` cheap and pure.** It runs before the tenant context is
  built, so it must not perform I/O — and there is no context available to it.
- **Assume at-least-once delivery.** Nothing in core deduplicates, so a handler
  whose action is not naturally idempotent needs its own guard — see
  [06 — Open questions](06-open-questions.md).
- **Finish within the invocation.** There is no queue; work abandoned at return
  is work lost.

### Testing a handler

Construct a `TenantContext` directly with a stub client and a `NoopLogger`, then
call the handler method. No Lambda, no network. For end-to-end coverage, build
the lambda with `clientFactory: () => myFakeClient` and drive it with
`makeEvent()` from core's test helpers pattern.

## 2. Add a webhook event type

For a third Heartland event (`item_updated`, `purchase_order_received`, …) the
lifecycle already exists; only the event-specific triple is new.

1. **Model** — `src/model/<event>.ts`: the payload shape, with an index
   signature for unmodelled fields.
2. **Parser** — `src/parsing/<event>-parser.ts`: returns `ParseResult<T>`, never
   throws. Validate what routing and logging need; normalize naming the way
   `parseItemCreatedBody` does if the payload is snake_case.
3. **Handler interface** — add to `src/handlers/handler.ts` following
   `ItemHandler`: a `name`, an optional `supports()`, one `handleX` method
   returning `Promise<WebhookOutcome | void>`.
4. **Factory** — `src/lambda/create-<event>-lambda.ts`: build a
   `TenantRegistry` from the caller's `tenants` and pass `createWebhookLambda`
   the pipeline record (`eventType`, `handler`, `registry`, `resolveTenant`,
   `logger`, `parse`, `describe`, `supports`, `handlerName`, `invoke`). Copy the
   existing factory; it is ~40 lines and almost all of it is the options doc
   comment. The options type takes a single `handler`, never a per-tenant map.
5. **Export** everything public from `src/index.ts`.
6. **Tests** — `tests/parsing/<event>-parser.test.ts` and
   `tests/lambda/create-<event>-lambda.test.ts`.

Do **not** add branches to `pipeline.ts`. If the new event genuinely cannot fit
the existing lifecycle, that is a design change worth an ADR, not an `if`.

Pick `describe()` fields an operator would want in a log line without opening
the payload: the id, whatever identifies the record in the store's own terms,
and any field that decides routing.

## 3. Add a Heartland endpoint

1. Add the response type to `src/clients/heartland-types.ts` — `snake_case`,
   only the fields you read, `PaginatedResponse<T>` for list endpoints.
2. Add the method to the `HeartlandApiClient` **interface** as well as
   `DefaultHeartlandApiClient`. Omitting the interface silently breaks every
   test fake.
3. Implement via the private `get`/`send` helpers so auth and error labelling
   stay uniform. `encodeURIComponent` every interpolated path value.
4. Export the new types from `src/index.ts`.
5. Test by stubbing `https.request` the way `tests/clients/*.test.ts` does.

Keep business sequencing out of the client. `createReceiptFromPurchaseOrder` is
multi-step only because Heartland's API forces the order; a sequence driven by a
store's policy belongs in that store's handler.

## Not in scope here

Adding a **module** — a connector for another system in the BAM ecosystem, a
scheduled-job runner, the deployment app — is a system-level change. See the
top-level [design record](../../design/) and specifically
[02 — Modules and boundaries](../../design/02-modules.md).
