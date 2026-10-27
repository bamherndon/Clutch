/**
 * Narrow helpers for reading untrusted JSON without casts.
 *
 * Each `getX` returns `undefined` when the field is absent or the wrong type;
 * the `OrNull` variants preserve an explicit JSON `null`, because Heartland
 * distinguishes "not sent" from "sent as null" on several item fields.
 */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getString(
  source: UnknownRecord,
  key: string
): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

export function getStringOrNull(
  source: UnknownRecord,
  key: string
): string | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

export function getNumber(
  source: UnknownRecord,
  key: string
): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

export function getNumberOrNull(
  source: UnknownRecord,
  key: string
): number | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'number' ? value : undefined;
}

export function getBoolean(
  source: UnknownRecord,
  key: string
): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function getBooleanOrNull(
  source: UnknownRecord,
  key: string
): boolean | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'boolean' ? value : undefined;
}

export function getRecordOrNull(
  source: UnknownRecord,
  key: string
): UnknownRecord | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return isRecord(value) ? value : undefined;
}
