import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type WebhookStatus = 'ok' | 'ignored' | 'error';

/**
 * Body returned for every webhook invocation.
 *
 * `details` carries whatever the tenant plugin reported, so the shape stays
 * stable across tenants while the domain payload varies.
 */
export interface WebhookResponseBody {
  status: WebhookStatus;
  eventType: string;
  ok: boolean;
  tenantId?: string;
  handler?: string;
  /** Why the event was ignored, or what went wrong. */
  reason?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Webhook endpoints always answer HTTP 200.
 *
 * Heartland retries and eventually disables endpoints that return errors, so
 * failures are reported in the body and in CloudWatch rather than by status
 * code. The `status` field is what callers and tests should assert on.
 */
export function webhookResponse(
  body: WebhookResponseBody
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
