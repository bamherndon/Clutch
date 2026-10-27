import { HeartlandTransaction } from '../model/transaction';
import { isRecord, getNumber } from './json';
import { ParseResult, parseError, parseOk } from './result';

/**
 * Parse a `sales_transaction_completed` webhook body.
 *
 * Heartland sends the transaction fields we care about at the top level and we
 * keep the rest verbatim, so this validates the required `id` and otherwise
 * passes the payload through.
 */
export function parseTransactionBody(
  body: string
): ParseResult<HeartlandTransaction> {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch (err) {
    return parseError(`invalid JSON: ${String(err)}`);
  }

  if (!isRecord(raw)) {
    return parseError('payload is not an object');
  }

  const id = getNumber(raw, 'id');
  if (typeof id !== 'number') {
    return parseError('payload is missing a numeric id');
  }

  return parseOk(raw as unknown as HeartlandTransaction);
}
