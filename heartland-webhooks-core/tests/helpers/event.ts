import { APIGatewayProxyEventV2 } from 'aws-lambda';

/**
 * Minimal Function URL event; only the fields core reads are populated.
 */
export function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> = {}
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'fn.lambda-url.us-east-1.on.aws',
      domainPrefix: 'fn',
      http: {
        method: 'POST',
        path: '/',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'heartland',
      },
      requestId: 'req-1',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

/**
 * Parse the JSON body of a webhook response.
 */
export function bodyOf(result: unknown): Record<string, unknown> {
  const body = (result as { body?: string }).body;
  return JSON.parse(body ?? '{}') as Record<string, unknown>;
}
