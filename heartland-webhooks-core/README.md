# heartland-webhooks-core

Tenant-agnostic transport for Heartland Retail webhooks: receiving, parsing, tenant
routing, and the Heartland REST client. **No business logic lives here** — callers inject
that as a `TransactionHandler` or `ItemHandler`.

## The contract

A caller supplies **one multi-tenant handler** plus the `TenantConfig` of every Heartland
instance it serves, and a way to tell those instances apart:

```ts
import {
  createTransactionLambda,
  fromPathSegment,
} from 'heartland-webhooks-core';

export const handler = createTransactionLambda({
  handler: new InventoryCheckHandler({ groupMe }),
  tenants: [
    {
      tenantId: 'bamherndon',
      baseUrl: 'https://bamherndon.retail.heartland.us',
      getToken: () => loadHeartlandToken('bamherndon'),
    },
    {
      tenantId: 'otherstore',
      baseUrl: 'https://otherstore.retail.heartland.us',
      getToken: () => loadHeartlandToken('otherstore'),
    },
  ],
  resolveTenant: fromPathSegment(0),
});
```

`tenants` is **configuration only** — it carries no business logic. The one handler
instance serves every tenant and is told which one it is working for on each invocation,
via `TenantContext`.

Register each tenant's webhook in Heartland against its own path
(`https://<fn-url>/bamherndon/transaction`) and `fromPathSegment(0)` routes it.

With exactly one tenant registered, `resolveTenant` may be omitted — core defaults to the
sole tenant. With more than one it is required, and construction throws if it is missing,
so a wiring mistake fails at cold start rather than on a live webhook.

## Writing a handler

Implement `TransactionHandler` or `ItemHandler`. Because a single instance serves every
tenant, a handler must hold **no per-tenant state**: take everything tenant-varying from
the `TenantContext` argument, never from constructor state or `process.env`.

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

Dependencies that are the same for every tenant (a shared HTTP client, a feature flag) can
go in the constructor. Anything that differs per store comes from the context.

- `supports` is optional; omitting it means "handles everything". It runs *before* the
  tenant context is built, so an unsupported event costs no secret load.
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

### What the token is for

Handlers never see the token. It exists solely so core can build the authenticated
`HeartlandApiClient` it exposes as `context.heartland`, which is how a handler calls
Heartland back (`getTicketLines`, `updateInventoryItem`, …). Core owns that construction so
each handler does not reimplement auth and token caching.

`getToken` is therefore **optional**. Omit it for a tenant whose handler only reads the
webhook payload and never calls Heartland back, and no secret is ever fetched for that
tenant. Should something call `context.heartland` anyway, every method rejects with a
message naming the tenant and the method, so the misconfiguration is obvious from one log
line instead of surfacing later as a confusing auth error.

## API

### Lambda factories
- `createTransactionLambda(options)` — `sales_transaction_completed` entrypoint
- `createItemLambda(options)` — `item_created` entrypoint

### Handler contract
- `TransactionHandler`, `ItemHandler`, `WebhookOutcome`

### Tenancy
- `TenantConfig` (what a deployment declares), `TenantContext` (what a handler receives),
  `TenantId`, `UnknownTenantError`
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
  handler: new MyHandler(),
  tenants: [myTenant],
  logger: new NoopLogger(),
  clientFactory: () => fakeHeartlandClient,
});
```

```bash
npm test             # jest with coverage
npm run build        # lint + test + tsc
```
