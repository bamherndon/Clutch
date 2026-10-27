/**
 * Parse outcome. Webhook parsing never throws: a malformed body is a routine
 * condition we want to log and answer, not an exception to unwind through the
 * Lambda entrypoint.
 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseOk<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function parseError<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}
