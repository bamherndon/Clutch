# ADR-0012 — Report shapes belong to the caller, not to core

**Status:** Accepted · **Date:** 2026-11-26

Closes the untyped-reports gap (formerly open question 3), which turned out not
to be a gap in Clutch at all.

## Context

`runReport<T = unknown>(reportType, query)` returns `unknown` unless the caller
says otherwise, and the docs listed that as a gap to close "if reports become
load-bearing".

Looking at why it is untyped: Heartland's reporting API is
`/api/reporting/{reportType}` with filters, groupings, and **requested columns**
passed in the query string. The response rows are keyed by the columns the query
asked for. The predecessor's row type shows it plainly:

```ts
export interface HeartlandItemsNotSoldRow {
  'location.name': string;
  'item.public_id': string;
  'current_inventory.days_since_last_sold': number | null;
  'ending_inventory.qty_owned': number;
}
```

Those keys are report columns, not fields of a report *type*. A different query
against the same `reportType` returns a different shape. So there is no static
type for "the analyzer report" to model — the shape is a function of the call.

Two further facts: nothing in Clutch calls `runReport` today, and the only
consumer in the predecessor is the `undersold-items` scheduled job, via a
`HeartlandReportRunner.findItemsNotSold(department, daysSinceLastSold, …)` whose
filters include `custom@department` — a BAM custom field, and a business
threshold.

## Decision

**Core's `runReport` stays generic, and core models no report shapes.**

- The generic `<T>` with an `unknown` default is the correct contract for a
  dynamically-shaped response: it makes the caller state what it asked for.
- A typed wrapper belongs with the automation that needs it: a row interface
  keyed by the columns that call requests, plus a named method encapsulating the
  filters — exactly the `HeartlandReportRunner.findItemsNotSold` shape, but
  living in the business-logic or scheduled-job module.
- `heartland-types.ts` gains no report row types.

## Consequences

- Adding a report-backed automation never touches core, which is the same
  property every other boundary in this package is built for.
- The query and the row type stay together, in one place, where a change to the
  requested columns and a change to the type are the same edit. Splitting them
  across packages would guarantee they drift.
- A report query encodes business filters — BAM custom fields, thresholds — so a
  core-level `findItemsNotSold` would be business logic in the transport package,
  which [ADR-0002](../../../design/adr/0002-transport-business-logic-split.md)
  and [ADR-0005](../../../design/adr/0005-assume-bam-item-schema.md) both put
  outside core.
- `unknown` is mildly unfriendly at the call site: a caller must declare a type
  to get anything useful. That is the intended pressure.
- If two automations ever want the same report, their row types duplicate. The
  shared home for that is the business-logic module, not core — and duplication
  until then is cheaper than a premature shared type.
- `runReport` remains unused surface in core until the jobs are ported. It was
  ported deliberately with its tests, and it is the one method whose signature
  this ADR says not to change.

## Alternatives considered

**Model each report type in `heartland-types.ts`.** The symmetry argument — every
other response is modelled there. Rejected: those are fixed-shape resources;
reports are query-shaped, and the model would be wrong for any caller that
requested different columns.

**A `ReportRunner` in core with named, typed methods.** Convenient, and it is
what the predecessor had. Rejected: every one of those methods carries business
filters, so it is business logic wearing a client's clothes.

**Drop `runReport` until something needs it.** Tempting — unused surface is a
liability. Rejected: the reporting URL has one non-obvious requirement (a unique
`request_client_uuid` per request) that is handled here and would otherwise be
rediscovered. Keeping the one generic method costs little and preserves that.
