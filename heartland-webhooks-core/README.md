# heartland-webhooks-core

Tenant-agnostic transport for Heartland Retail webhooks: receiving, parsing, tenant
routing, and the Heartland REST client. **No business logic lives here** — callers inject
that as a `TransactionHandler` or `ItemHandler`.

## The contract

A caller supplies one `TenantDefinition` per Heartland instance and a way to tell them
apart:

```ts
import {
  createTransactionLambda,
  fromPathSegment,
} from 'heartland-webhooks-core';

export const handler = createTransactionLambda({
  tenants: [
    {
      tenantId: 'bamherndon',
      baseUrl: 'https://bamherndon.retail.heartland.us',
      getToken: () => loadHeartlandToken('bamherndon'),
      handler: new BamHerndonTransactionHandler({ groupMe }),
    },
    {
      tenantId: 'otherstore',
      baseUrl: 'https://otherstore.retail.heartland.us',
      getToken: () => loadHeartlandToken('otherstore'),
      handler: new OtherStoreTransactionHandler(),
    },
  ],
  resolveTenant: fromPathSegment(0),
});
```

Register each tenant's webhook in Heartland against its own path
(`https://<fn-url>/bamherndon/transaction`) and `fromPathSegment(0)` routes it.

With exactly one tenant registered, `resolveTenant` may be omitted — core defaults to the
sole tenant. With more than one it is required, and construction throws if it is missing.

## Writing a plugin

Implement `TransactionHandler` or `ItemHandler`. Take everything tenant-varying from the
`TenantContext` argument, never from `process.env`:

```ts
import {
  TransactionHandler,
  HeartlandTransaction,
  TenantContext,
  WebhookOutcome,
} from 'heartland-webhooks-core';

export class InventoryCheckHandler implements TransactionHandler {
  readonly name = 'inventory-checks';

  supports(tx: HeartlandTransaction): boolean {
    return tx.type === 'Ticket' || tx.type === 'Return';
  }

  async handleTransaction(
    tx: HeartlandTransaction,
    { heartland, logger }: TenantContext
  ): Promise<WebhookOutcome> {
    const lines = await heartland.getTicketLines(tx.id);
    logger.info(`checking ${lines.results.length} lines`);
    // …domain logic…
    return { ok: true, details: { checked: lines.results.length } };
  }
}
```

- `supports` is optional; omitting it means "handles everything".
- Returning nothing means success. Returning `{ ok: false, details }` reports a business
  failure, and `details` is echoed into the response body.
- Throwing is caught, logged, and reported as `status: "error"`.

## What core guarantees

**Webhooks always answer HTTP 200.** Heartland retries and eventually disables endpoints
that return errors, so every failure — unknown tenant, unparseable body, plugin exception —
is reported in the response body's `status` field and in CloudWatch, never by status code.
Assert on `status`, not `statusCode`.

Response body:

```jsonc
{
  "status": "ok" | "ignored" | "error",
  "eventType": "sales_transaction_completed",
  "ok": true,
  "tenantId": "bamherndon",
  "handler": "inventory-checks",
  "reason": "…",        // when ignored or error
  "details": { },       // whatever the plugin returned
  "transactionId": 77   // payload-specific fields
}
```

**Tenant credentials load lazily and cache per process.** `getToken` is called on a
tenant's first request and memoized for the Lambda's lifetime, so a deployment serving many
tenants only pays for the ones receiving traffic. A failed load is *not* cached — a
transient Secrets Manager error retries on the next invocation instead of poisoning the
tenant until the next cold start.

## API

### Lambda factories
- `createTransactionLambda(options)` — `sales_transaction_completed` entrypoint
- `createItemLambda(options)` — `item_created` entrypoint

### Plugin contract
- `TransactionHandler`, `ItemHandler`, `WebhookOutcome`

### Tenancy
- `TenantDefinition`, `TenantContext`, `TenantId`, `UnknownTenantError`
- `TenantRegistry` — holds tenants, builds and memoizes their contexts
- Resolvers: `fromPathSegment`, `fromPathParameter`, `fromHeader`, `fromQueryString`,
  `fixedTenant`, `firstOf`

`fromPathParameter` only works behind an API Gateway route; Lambda Function URLs have no
route templates and never populate `pathParameters`. Use `fromPathSegment` there.

### Parsing
- `parseTransactionBody`, `parseItemCreatedBody` — return `ParseResult<T>`, never throw
- `isRecord`, `getString`, `getNumberOrNull`, … — typed readers for untrusted JSON. The
  `OrNull` variants preserve an explicit JSON `null`, which Heartland distinguishes from an
  absent field on several item fields.

### Models
- `HeartlandTransaction`, `TransactionKind`, `classifyTransaction`, `summarizeTransaction`
- `HeartlandItemCreatedPayload`, `HeartlandItemCustomFields` — camelCased from Heartland's
  snake_case and its trailing-`?` boolean convention (`active?` → `active`)

### Clients
- `HeartlandApiClient` / `DefaultHeartlandApiClient` — bound to one tenant's base URL and
  token. Methods: `getTicketLines`, `getInventoryValues`, `getInventoryItem`,
  `updateInventoryItem`, `updateInventoryItemImage`, `runReport`, `listPurchaseOrders`,
  `getPurchaseOrderLines`, `createReceipt`, `getReceiptByOrderId`, `addReceiptLine`,
  `createReceiptFromPurchaseOrder`, `completeReceipt`
- `requestJson`, `buildUrl`, `buildQueryString` — the shared HTTPS/JSON helper, exported so
  tenant packages can build their own clients (BrickLink, GroupMe) on the same base.
  `requestJson` takes either `token` (Bearer) or a pre-built `authorization` header for
  schemes like OAuth 1.0a.

### Logging
- `Logger`, `ConsoleLogger`, `NoopLogger`. Core tags lines with the event type and tenant
  id. `ConsoleLogger` suppresses `debug` unless constructed with `debugEnabled`, which
  keeps verbose per-line tracing in the code without flooding CloudWatch. Use `NoopLogger`
  in tests.

## Testing

`createTransactionLambda` and `createItemLambda` accept a `clientFactory`, letting tests
substitute a fake `HeartlandApiClient` without touching the network:

```ts
const lambda = createTransactionLambda({
  tenants: [myTenant],
  logger: new NoopLogger(),
  clientFactory: () => fakeHeartlandClient,
});
```

```bash
npm test             # jest with coverage
npm run build        # lint + test + tsc
```
