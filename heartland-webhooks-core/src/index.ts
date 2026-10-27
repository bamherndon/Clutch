/**
 * heartland-webhooks-core
 *
 * Tenant-agnostic Heartland Retail webhook transport: receiving, parsing,
 * tenant routing, and the REST client. Business logic belongs in the
 * TransactionHandler / ItemHandler implementations a caller injects.
 */

// Models
export {
  HeartlandTransaction,
  HeartlandTransactionType,
  TransactionKind,
  classifyTransaction,
  summarizeTransaction,
} from './model/transaction';
export {
  HeartlandItemCreatedPayload,
  HeartlandItemCustomFields,
} from './model/item';

// Parsing
export { ParseResult, parseOk, parseError } from './parsing/result';
export { parseTransactionBody } from './parsing/transaction-parser';
export { parseItemCreatedBody } from './parsing/item-parser';
export {
  UnknownRecord,
  isRecord,
  getString,
  getStringOrNull,
  getNumber,
  getNumberOrNull,
  getBoolean,
  getBooleanOrNull,
  getRecordOrNull,
} from './parsing/json';

// Plugin contract
export {
  TransactionHandler,
  ItemHandler,
  WebhookOutcome,
  toOutcome,
} from './handlers/handler';

// Tenancy
export {
  TenantId,
  TenantDefinition,
  TenantContext,
  UnknownTenantError,
} from './tenancy/tenant';
export {
  TenantRegistry,
  TenantRegistryOptions,
  HeartlandClientFactory,
} from './tenancy/registry';
export {
  TenantResolver,
  fromPathSegment,
  fromPathParameter,
  fromHeader,
  fromQueryString,
  fixedTenant,
  firstOf,
} from './tenancy/resolver';

// Lambda entrypoint factories
export {
  createTransactionLambda,
  TransactionLambdaOptions,
} from './lambda/create-transaction-lambda';
export {
  createItemLambda,
  ItemLambdaOptions,
} from './lambda/create-item-lambda';
export {
  WebhookResponseBody,
  WebhookStatus,
  webhookResponse,
} from './lambda/response';

// Clients
export {
  HeartlandApiClient,
  DefaultHeartlandApiClient,
} from './clients/heartland-api-client';
export {
  PaginatedResponse,
  TicketLine,
  TicketLinesResponse,
  InventoryValueRow,
  InventoryValuesResponse,
  InventoryItem,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrdersResponse,
  PurchaseOrderLine,
  PurchaseOrderLinesResponse,
  Receipt,
  ReceiptLine,
  HeartlandReportQuery,
} from './clients/heartland-types';
export {
  requestJson,
  JsonRequestOptions,
  buildUrl,
  buildQueryString,
  QueryParams,
} from './clients/http';

// Logging
export {
  Logger,
  ConsoleLogger,
  NoopLogger,
  safeStringify,
} from './logging/logger';
