# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Documentation upkeep

Before committing and pushing, update `CLAUDE.md`, the root `README.md`, and the affected
package's `README.md` to reflect any change — new packages, changed public API, new
handler interfaces, new environment variables, updated architecture. These files should
always describe the current state of the codebase.

## Prerequisites

- Node.js v20

## Commands

npm workspaces; install once at the root.

```bash
npm install          # all workspaces
npm run build        # lint + test + tsc, every package
npm test             # tests only
npm run lint         # lint only
```

Per package:

```bash
cd heartland-webhooks-core
npm run build
npm test
npx jest tests/lambda/create-transaction-lambda.test.ts   # single file
```

## Architecture

Clutch separates webhook **transport** from tenant **business logic**.

`heartland-webhooks-core` owns the transport and must stay tenant-agnostic. It contains no
business logic and no knowledge of any particular store. Business logic arrives as a
`TransactionHandler` / `ItemHandler` that the calling module constructs and injects at
Lambda initialization.

Two invariants hold the design together. Breaking either defeats the refactor that created
this repo:

1. **Nothing in core reads tenant configuration from `process.env`.** Every tenant-varying
   value — base URL, API token, Heartland client — reaches a plugin through
   `TenantContext`. Reading the environment inside a handler or strategy is what made the
   predecessor single-tenant.
2. **Core does not import business logic.** Dependencies point inward: tenant packages
   depend on core, never the reverse.

### Layout

```
heartland-webhooks-core/src/
  model/        Heartland payload types + classification helpers
  parsing/      ParseResult-returning body parsers; typed JSON readers
  handlers/     TransactionHandler / ItemHandler — the plugin contract
  tenancy/      TenantDefinition, TenantRegistry, TenantResolver
  lambda/       pipeline.ts (shared plumbing) + the two entrypoint factories
  clients/      requestJson + HeartlandApiClient
  logging/      Logger, ConsoleLogger, NoopLogger
```

`lambda/pipeline.ts` holds the one shared request flow — envelope logging, tenant
resolution, parsing, context construction, error containment, response shaping. The
transaction and item factories only configure it. New webhook types should add a factory
over the same pipeline rather than a new copy of the flow.

### Conventions

- Webhook endpoints always return HTTP 200; failures are reported in the body's `status`
  field. Heartland disables endpoints that keep returning errors. Tests assert on `status`,
  not `statusCode`.
- Parsers return `ParseResult<T>` and never throw. A malformed webhook body is routine.
- Plugin exceptions are contained by the pipeline, logged, and reported as
  `status: "error"`.
- Tenant tokens load lazily via `getToken` and memoize per process; failed loads are not
  cached.
- Tests use `NoopLogger` and inject a fake client through `clientFactory`. No test should
  make a network call.

## Relationship to OperationalHooks

`../OperationalHooks` is the predecessor and is still the deployed system. **Do not modify
it.** Clutch is a clean reimplementation; code is ported deliberately, not copied wholesale.

Not yet ported: the Bricks & Minifigs Herndon business logic (transaction strategies, item
image sourcing, GroupMe/BrickLink/Toyhouse clients), the scheduled jobs
(`undersold-items`, `receive-open-orders`), and the CDK app.

Two bugs found in `OperationalHooks` while reading it, worth not reproducing here:

- The item handler read `TOYHOUSE_MASTER_DATA_S3_PATH` while the CDK stack set
  `TOYHOUSE_MASTER_DATA_S3_URI`, so Toyhouse lookups could never work.
- `handlers/underselling-items/` was a no-op stub, unreferenced by the stack and confusingly
  near-identical in name to the real `undersold-items` handler.

## External APIs

- Heartland Retail: https://dev.retail.heartland.us/
- BrickLink: https://www.bricklink.com/v3/api.page
- GroupMe: https://dev.groupme.com/docs/v3
