import * as https from 'https';

export interface JsonRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Bearer token. Mutually exclusive with `authorization`. */
  token?: string;
  /** Full pre-built Authorization header, for non-Bearer schemes (e.g. OAuth 1.0a). */
  authorization?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Label used in error messages, e.g. "Heartland API". */
  api?: string;
}

/**
 * Single HTTPS+JSON request helper used by every client in this package.
 *
 * Resolves with the parsed body (`{}` when empty) on 2xx, and rejects with the
 * status code and raw body otherwise so failures stay diagnosable in logs.
 */
export function requestJson<T>(
  url: string,
  options: JsonRequestOptions = {}
): Promise<T> {
  const {
    method = 'GET',
    token,
    authorization,
    headers = {},
    body,
    api = 'API',
  } = options;

  if (token && authorization) {
    return Promise.reject(
      new Error('requestJson: pass either `token` or `authorization`, not both')
    );
  }

  const authHeader = authorization ?? (token ? `Bearer ${token}` : undefined);
  const payload = body === undefined ? undefined : JSON.stringify(body);

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authHeader ? { Authorization: authHeader } : {}),
    ...(payload !== undefined
      ? { 'Content-Length': Buffer.byteLength(payload).toString() }
      : {}),
    ...headers,
  };

  return new Promise<T>((resolve, reject) => {
    const req = https.request(url, { method, headers: requestHeaders }, (res) => {
      if (!res) {
        reject(new Error(`No response from ${api}`));
        return;
      }

      let data = '';
      res.on('data', (chunk: Buffer | string) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode} from ${api}: ${data}`));
          return;
        }
        try {
          resolve((data ? JSON.parse(data) : {}) as T);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Join a base URL and a path+query, tolerating slashes on either side.
 */
export function buildUrl(baseUrl: string, pathWithQuery: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = pathWithQuery.startsWith('/')
    ? pathWithQuery
    : `/${pathWithQuery}`;
  return `${trimmedBase}${trimmedPath}`;
}

type QueryValue = string | number | boolean;
export type QueryParams = Record<
  string,
  QueryValue | QueryValue[] | undefined
>;

/**
 * Build a query string, repeating the key for array values (`k=1&k=2`) as
 * Heartland's reporting API expects.
 */
export function buildQueryString(query: QueryParams): string {
  const params: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const arrayValue of value) {
        params.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(arrayValue))}`
        );
      }
      continue;
    }
    params.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    );
  }
  return params.join('&');
}
