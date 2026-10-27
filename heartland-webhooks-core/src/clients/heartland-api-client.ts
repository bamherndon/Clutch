import * as crypto from 'crypto';
import { Logger, NoopLogger } from '../logging/logger';
import { buildQueryString, buildUrl, requestJson } from './http';
import {
  HeartlandReportQuery,
  InventoryItem,
  InventoryValuesResponse,
  PaginatedResponse,
  PurchaseOrderLinesResponse,
  PurchaseOrderStatus,
  PurchaseOrdersResponse,
  Receipt,
  ReceiptLine,
  TicketLinesResponse,
} from './heartland-types';

/**
 * Heartland Retail REST API.
 *
 * Tenant-agnostic: an instance is bound to one tenant's base URL and token,
 * so a multi-tenant deployment holds one client per tenant.
 *
 * Docs: https://dev.retail.heartland.us/
 */
export interface HeartlandApiClient {
  getTicketLines(ticketId: number): Promise<TicketLinesResponse>;
  getInventoryValues(itemId: number): Promise<InventoryValuesResponse>;
  getInventoryItem(itemId: number): Promise<InventoryItem>;
  updateInventoryItem(
    itemId: number,
    updates: Partial<InventoryItem>
  ): Promise<InventoryItem>;
  updateInventoryItemImage(itemId: number, imageUrl: string): Promise<unknown>;
  runReport<T = unknown>(
    reportType: string,
    query?: HeartlandReportQuery
  ): Promise<T>;
  listPurchaseOrders(
    status: PurchaseOrderStatus,
    page?: number
  ): Promise<PurchaseOrdersResponse>;
  getPurchaseOrderLines(
    purchaseOrderId: number
  ): Promise<PurchaseOrderLinesResponse>;
  createReceipt(purchaseOrderId: number, locationId: number): Promise<void>;
  getReceiptByOrderId(orderId: number): Promise<Receipt>;
  addReceiptLine(receiptId: number, line: ReceiptLine): Promise<unknown>;
  createReceiptFromPurchaseOrder(
    purchaseOrderId: number,
    locationId: number
  ): Promise<Receipt>;
  completeReceipt(receiptId: number): Promise<Receipt>;
}

const API = 'Heartland API';

/**
 * HTTP implementation of {@link HeartlandApiClient}.
 */
export class DefaultHeartlandApiClient implements HeartlandApiClient {
  private readonly log: Logger;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    logger: Logger = new NoopLogger()
  ) {
    this.log = logger.child('heartland-api');
  }

  async getTicketLines(ticketId: number): Promise<TicketLinesResponse> {
    return this.get<TicketLinesResponse>(
      `/api/sales/tickets/${encodeURIComponent(String(ticketId))}/lines?per_page=500`
    );
  }

  async getInventoryValues(itemId: number): Promise<InventoryValuesResponse> {
    return this.get<InventoryValuesResponse>(
      `/api/inventory/values` +
        `?group[]=item_id&group[]=location_id` +
        `&item_id=${encodeURIComponent(String(itemId))}` +
        `&exclude_empty_locations=true&per_page=50`
    );
  }

  async getInventoryItem(itemId: number): Promise<InventoryItem> {
    return this.get<InventoryItem>(
      `/api/items/${encodeURIComponent(String(itemId))}`
    );
  }

  async updateInventoryItem(
    itemId: number,
    updates: Partial<InventoryItem>
  ): Promise<InventoryItem> {
    return this.send<InventoryItem>(
      'PUT',
      `/api/items/${encodeURIComponent(String(itemId))}`,
      updates
    );
  }

  async updateInventoryItemImage(
    itemId: number,
    imageUrl: string
  ): Promise<unknown> {
    return this.send<unknown>(
      'POST',
      `/api/items/${encodeURIComponent(String(itemId))}/images`,
      { source: 'url', url: imageUrl }
    );
  }

  async listPurchaseOrders(
    status: PurchaseOrderStatus,
    page = 1
  ): Promise<PurchaseOrdersResponse> {
    return this.get<PurchaseOrdersResponse>(
      `/api/purchasing/orders` +
        `?status=${encodeURIComponent(status)}` +
        `&page=${encodeURIComponent(String(page))}`
    );
  }

  async getPurchaseOrderLines(
    purchaseOrderId: number
  ): Promise<PurchaseOrderLinesResponse> {
    return this.get<PurchaseOrderLinesResponse>(
      `/api/purchasing/orders/${encodeURIComponent(String(purchaseOrderId))}/lines` +
        `?per_page=500`
    );
  }

  async createReceipt(
    purchaseOrderId: number,
    locationId: number
  ): Promise<void> {
    await this.send<unknown>('POST', `/api/purchasing/receipts`, {
      order_id: purchaseOrderId,
      receive_at_location_id: locationId,
    });
  }

  async getReceiptByOrderId(orderId: number): Promise<Receipt> {
    const response = await this.get<PaginatedResponse<Receipt>>(
      `/api/purchasing/receipts` +
        `?order_id=${encodeURIComponent(String(orderId))}&status=pending`
    );
    const receipt = response.results[0];
    if (!receipt) {
      throw new Error(`No pending receipt found for order_id ${orderId}`);
    }
    return receipt;
  }

  async addReceiptLine(
    receiptId: number,
    line: ReceiptLine
  ): Promise<unknown> {
    return this.send<unknown>(
      'POST',
      `/api/purchasing/receipts/${encodeURIComponent(String(receiptId))}/lines`,
      line
    );
  }

  /**
   * Create a pending receipt for a PO and copy every PO line onto it.
   *
   * Lines without an `item_id` are skipped: Heartland uses them for comments
   * and other non-stock rows that cannot be received.
   */
  async createReceiptFromPurchaseOrder(
    purchaseOrderId: number,
    locationId: number
  ): Promise<Receipt> {
    const linesResponse = await this.getPurchaseOrderLines(purchaseOrderId);
    this.log.debug(`PO ${purchaseOrderId} lines`, {
      total: linesResponse.total,
      count: linesResponse.results.length,
    });

    await this.createReceipt(purchaseOrderId, locationId);
    const receipt = await this.getReceiptByOrderId(purchaseOrderId);
    this.log.debug(`Created receipt ${receipt.id} for PO ${purchaseOrderId}`);

    for (const line of linesResponse.results) {
      if (line.item_id == null) {
        this.log.debug(`Skipping PO line ${line.id}: no item_id`);
        continue;
      }
      await this.addReceiptLine(receipt.id, {
        item_id: line.item_id,
        qty: line.qty ?? 0,
        receipt_id: receipt.id,
        unit_cost: line.unit_cost,
      });
    }

    return receipt;
  }

  async completeReceipt(receiptId: number): Promise<Receipt> {
    return this.send<Receipt>(
      'PUT',
      `/api/purchasing/receipts/${encodeURIComponent(String(receiptId))}`,
      { status: 'accepted' }
    );
  }

  async runReport<T = unknown>(
    reportType: string,
    query: HeartlandReportQuery = {}
  ): Promise<T> {
    // Heartland requires a unique client UUID per reporting request.
    const queryString = buildQueryString({
      ...query,
      request_client_uuid: crypto.randomUUID(),
    });
    const base = `/api/reporting/${encodeURIComponent(reportType)}`;
    return this.get<T>(queryString ? `${base}?${queryString}` : base);
  }

  private get<T>(pathWithQuery: string): Promise<T> {
    return requestJson<T>(buildUrl(this.baseUrl, pathWithQuery), {
      token: this.token,
      api: API,
    });
  }

  private send<T>(
    method: 'POST' | 'PUT',
    pathWithQuery: string,
    body: unknown
  ): Promise<T> {
    return requestJson<T>(buildUrl(this.baseUrl, pathWithQuery), {
      method,
      token: this.token,
      body,
      api: API,
    });
  }
}
