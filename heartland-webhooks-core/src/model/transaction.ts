export type HeartlandTransactionType = 'Ticket' | 'Return' | string;

/**
 * Body of a Heartland `sales_transaction_completed` webhook.
 *
 * Heartland sends more fields than we model explicitly, so the index signature
 * is intentional: callers can reach unmodelled fields without a cast.
 */
export interface HeartlandTransaction {
  id: number;
  type: HeartlandTransactionType;
  customer_id?: number;
  customer_name?: string;
  source_location_id?: number;
  sales_rep?: string;
  total: number;
  parent_transaction_id?: number | null;
  status?: string;
  completed_at?: string;
  local_completed_at?: string;
  // Heartland literal field name
  'completed?'?: boolean;
  balance?: number;
  [key: string]: unknown;
}

export type TransactionKind = 'sale' | 'return' | 'other';

/**
 * Classify a transaction as sale / return / other.
 *
 * Prefers Heartland's explicit `type`, falling back to the sign of `total`.
 */
export function classifyTransaction(tx: HeartlandTransaction): TransactionKind {
  if (tx.type === 'Ticket') return 'sale';
  if (tx.type === 'Return') return 'return';

  if (typeof tx.total === 'number') {
    if (tx.total > 0) return 'sale';
    if (tx.total < 0) return 'return';
  }

  return 'other';
}

/**
 * The subset of transaction fields worth logging on every webhook.
 */
export function summarizeTransaction(
  tx: HeartlandTransaction,
  kind: TransactionKind
): Record<string, unknown> {
  return {
    kind,
    id: tx.id,
    type: tx.type,
    total: tx.total,
    parent_transaction_id: tx.parent_transaction_id,
    customer_id: tx.customer_id,
    customer_name: tx.customer_name,
    source_location_id: tx.source_location_id,
    sales_rep: tx.sales_rep,
    status: tx.status,
    completed_flag: tx['completed?'],
    balance: tx.balance,
    completed_at: tx.completed_at,
    local_completed_at: tx.local_completed_at,
  };
}
