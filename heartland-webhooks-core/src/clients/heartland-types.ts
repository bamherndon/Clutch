import { HeartlandItemCustomFields } from '../model/item';
import { QueryParams } from './http';

export interface PaginatedResponse<T> {
  total: number;
  pages: number;
  results: T[];
}

/**
 * Ticket line from `GET /api/sales/tickets/{ticket_id}/lines`.
 */
export interface TicketLine {
  id: number;
  /** ItemLine, TaxLine, etc. */
  type: string;
  item_id?: number;
  item_description?: string;
  description?: string;
  [key: string]: unknown;
}
export type TicketLinesResponse = PaginatedResponse<TicketLine>;

/**
 * Inventory value row from `GET /api/inventory/values`.
 */
export interface InventoryValueRow {
  item_id: number;
  location_id?: number;
  qty?: number;
  qty_on_hand?: number;
  qty_committed?: number;
  qty_on_po?: number;
  qty_in_transit?: number;
  qty_available?: number;
  unit_cost?: number;
  [key: string]: unknown;
}
export type InventoryValuesResponse = PaginatedResponse<InventoryValueRow>;

export interface InventoryItem {
  id: number;
  description?: string;
  long_description?: string;
  cost?: number | null;
  price?: number | null;
  public_id?: string;
  default_lookup_id?: number | null;
  custom?: HeartlandItemCustomFields | null;
  [key: string]: unknown;
}

export type PurchaseOrderStatus = 'pending' | 'open' | 'closed' | 'canceled';

export interface PurchaseOrder {
  id: number;
  status?: string;
  receive_at_location_id?: number | null;
  created_at?: string;
  updated_at?: string;
  created_by_user_id?: number | null;
  updated_by_user_id?: number | null;
  [key: string]: unknown;
}
export type PurchaseOrdersResponse = PaginatedResponse<PurchaseOrder>;

export interface PurchaseOrderLine {
  id: number;
  purchase_order_id?: number;
  item_id?: number;
  qty?: number;
  unit_cost?: number | null;
  [key: string]: unknown;
}
export type PurchaseOrderLinesResponse = PaginatedResponse<PurchaseOrderLine>;

export interface Receipt {
  id: number;
  purchase_order_id?: number | null;
  location_id?: number | null;
  [key: string]: unknown;
}

export interface ReceiptLine {
  item_id: number;
  qty: number;
  receipt_id?: number;
  unit_cost?: number | null;
}

export type HeartlandReportQuery = QueryParams;
