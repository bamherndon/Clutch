# Clutch

Multi-tenant operational automation for Heartland Retail.

Clutch separates the **transport** of Heartland webhooks from the **business logic** that
reacts to them. Transport is a reusable package; business logic is a multi-tenant handler
that the calling module injects at Lambda initialization.

## Why this exists

Clutch is the successor to [`OperationalHooks`](../OperationalHooks), where two problems had
become structural:

1. **Webhook plumbing was fused to business logic.** Each handler re-implemented envelope
   logging, JSON parsing, secret loading, and error handling inline, interleaved with the
   checks it actually cared about. None of it could be reused or tested independently.
2. **One Heartland instance was assumed.** Base URL, API token, and GroupMe bot id were
   read from `process.env` deep inside handlers and strategies, so a single deployment
   could only ever serve one store.

A third followed from the second: because configuration was ambient, a handler could not be
written once and reused across stores. Clutch makes handlers multi-tenant by construction —
tenancy arrives as an argument, so there is nowhere for per-store state to hide.

Clutch fixes both: `heartland-webhooks-core` owns the transport and knows nothing about any
particular store, and every tenant-varying value arrives through a `TenantContext` instead
of the environment.

## Packages

| Package | Purpose |
|---|---|
| [`heartland-webhooks-core`](./heartland-webhooks-core) | Reusable, tenant-agnostic webhook receiving, parsing, tenant routing, and the Heartland REST client |
| [`design`](./design) | Top-level design record: the BAM ecosystem, module boundaries, invariants, roadmap, and system-wide ADRs. Prose only — nothing to build. Each module documents itself in its own `design/` folder |

## Architecture

```
Heartland (tenant A) ─┐
Heartland (tenant B) ─┼─▶ Lambda Function URL
Heartland (tenant C) ─┘           │
                                  ▼
            ┌───────────────────────────────────────────┐
            │ heartland-webhooks-core                   │
            │                                           │
            │  1. log envelope                          │
            │  2. resolve tenant  (TenantResolver)      │
            │  3. parse body      (→ typed payload)     │
            │  4. build context   (TenantRegistry)      │
            │  5. invoke handler  (contain failures)    │
            │  6. shape response                        │
            └───────────────────┬───────────────────────┘
                                │ TenantContext
                                ▼
                 one multi-tenant TransactionHandler
                      / ItemHandler — business logic
                   (inventory checks, image sourcing,
                    GroupMe alerts, …)
```

A single deployment serves many tenants, and **a single handler instance serves them all**.
Core resolves which Heartland instance a request came from and hands the handler that
tenant's `TenantContext` — identity, base URL, logger, and an authenticated
`HeartlandApiClient`. The handler stays stateless with respect to tenancy; nothing about a
store is baked into it at construction.

Tokens load lazily on a tenant's first request and are memoized per process, so a
deployment with fifty tenants does not fetch fifty secrets at cold start — only the tenants
that actually receive traffic. Credentials exist purely so core can build that client;
handlers never see a token, and a tenant whose handler never calls Heartland back needs no
credentials at all.

## Development

Node.js v20. The repo uses npm workspaces, so install once at the root:

```bash
npm install          # installs all workspaces
npm run build        # lint + test + tsc across all packages
npm test             # tests only
npm run lint         # lint only
```

Per package:

```bash
cd heartland-webhooks-core
npm run build        # lint + test + tsc
npm test             # jest with coverage
npx jest tests/lambda/create-transaction-lambda.test.ts   # single file
```

CI runs `npm ci && npm run build` on Node 20 for every pull request and every push to
`main` ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). That is the same command
as above, so a green local build means a green CI run.

## Status

`heartland-webhooks-core` is complete and tested. Still to come:

- A tenant package carrying the Bricks & Minifigs Herndon business logic, ported from
  `OperationalHooks` (transaction strategies, item image sourcing, GroupMe/BrickLink/Toyhouse
  clients).
- The scheduled jobs (`undersold-items`, `receive-open-orders`), which are not webhooks and
  need a separate scheduled-task seam.
- A CDK app deploying the multi-tenant Function URLs.

`OperationalHooks` remains the deployed system and is untouched.

## External APIs

- Heartland Retail: https://dev.retail.heartland.us/
- BrickLink: https://www.bricklink.com/v3/api.page
- GroupMe: https://dev.groupme.com/docs/v3
