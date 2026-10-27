import { HeartlandApiClient } from '../../src/clients/heartland-api-client';
import {
  TransactionHandler,
  WebhookOutcome,
} from '../../src/handlers/handler';
import { createTransactionLambda } from '../../src/lambda/create-transaction-lambda';
import { NoopLogger } from '../../src/logging/logger';
import { HeartlandTransaction } from '../../src/model/transaction';
import { fromPathSegment } from '../../src/tenancy/resolver';
import { TenantConfig, TenantContext } from '../../src/tenancy/tenant';
import { bodyOf, makeEvent } from '../helpers/event';

const fakeClient = {} as HeartlandApiClient;
const clientFactory = () => fakeClient;

/**
 * One multi-tenant handler. It records every call so tests can assert which
 * tenant context each invocation received.
 */
class RecordingHandler implements TransactionHandler {
  readonly calls: Array<{ tx: HeartlandTransaction; context: TenantContext }> =
    [];

  constructor(
    readonly name = 'recording',
    private readonly outcome: WebhookOutcome | Error | undefined = undefined,
    private readonly supported = true
  ) {}

  supports(): boolean {
    return this.supported;
  }

  async handleTransaction(
    tx: HeartlandTransaction,
    context: TenantContext
  ): Promise<WebhookOutcome | void> {
    this.calls.push({ tx, context });
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }

  /** The tenant ids this handler was invoked for, in order. */
  get tenantIds(): string[] {
    return this.calls.map((call) => call.context.tenantId);
  }
}

function tenant(tenantId: string): TenantConfig {
  return {
    tenantId,
    baseUrl: `https://${tenantId}.retail.heartland.us`,
    getToken: async () => `${tenantId}-token`,
  };
}

const saleBody = JSON.stringify({ id: 77, type: 'Ticket', total: 25 });

function lambdaFor(
  handler: TransactionHandler,
  tenants: TenantConfig[],
  resolveTenant = fromPathSegment(0)
) {
  return createTransactionLambda({
    handler,
    tenants,
    resolveTenant,
    logger: new NoopLogger(),
    clientFactory,
  });
}

describe('createTransactionLambda — construction', () => {
  it('rejects an empty tenant list', () => {
    expect(() =>
      createTransactionLambda({
        handler: new RecordingHandler(),
        tenants: [],
        logger: new NoopLogger(),
      })
    ).toThrow('no tenants registered');
  });

  it('requires a resolver when more than one tenant is registered', () => {
    expect(() =>
      createTransactionLambda({
        handler: new RecordingHandler(),
        tenants: [tenant('a'), tenant('b')],
        logger: new NoopLogger(),
        clientFactory,
      })
    ).toThrow('resolveTenant is required');
  });

  it('defaults to the sole tenant when only one is registered', async () => {
    const handler = new RecordingHandler();
    const lambda = createTransactionLambda({
      handler,
      tenants: [tenant('solo')],
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(await lambda(makeEvent({ body: saleBody })));
    expect(body.status).toBe('ok');
    expect(body.tenantId).toBe('solo');
    expect(handler.tenantIds).toEqual(['solo']);
  });
});

describe('createTransactionLambda — one handler, many tenants', () => {
  it('invokes the same handler instance for every tenant', async () => {
    const handler = new RecordingHandler();
    const lambda = lambdaFor(handler, [
      tenant('bamherndon'),
      tenant('otherstore'),
      tenant('thirdstore'),
    ]);

    await lambda(makeEvent({ rawPath: '/bamherndon', body: saleBody }));
    await lambda(makeEvent({ rawPath: '/otherstore', body: saleBody }));
    await lambda(makeEvent({ rawPath: '/thirdstore', body: saleBody }));
    await lambda(makeEvent({ rawPath: '/bamherndon', body: saleBody }));

    expect(handler.tenantIds).toEqual([
      'bamherndon',
      'otherstore',
      'thirdstore',
      'bamherndon',
    ]);
  });

  it('gives each invocation the calling tenant’s context', async () => {
    const handler = new RecordingHandler();
    const lambda = lambdaFor(handler, [
      tenant('bamherndon'),
      tenant('otherstore'),
    ]);

    await lambda(makeEvent({ rawPath: '/bamherndon', body: saleBody }));
    await lambda(makeEvent({ rawPath: '/otherstore', body: saleBody }));

    expect(handler.calls[0].context.baseUrl).toBe(
      'https://bamherndon.retail.heartland.us'
    );
    expect(handler.calls[1].context.baseUrl).toBe(
      'https://otherstore.retail.heartland.us'
    );
    // Distinct contexts, not a shared mutable one.
    expect(handler.calls[0].context).not.toBe(handler.calls[1].context);
  });

  it('reuses one context per tenant across requests', async () => {
    const handler = new RecordingHandler();
    const lambda = lambdaFor(handler, [tenant('a'), tenant('b')]);

    await lambda(makeEvent({ rawPath: '/a', body: saleBody }));
    await lambda(makeEvent({ rawPath: '/a', body: saleBody }));

    expect(handler.calls[0].context).toBe(handler.calls[1].context);
  });

  it('reports an unknown tenant without invoking the handler', async () => {
    const handler = new RecordingHandler();
    const lambda = lambdaFor(handler, [tenant('a'), tenant('b')]);

    const result = await lambda(
      makeEvent({ rawPath: '/nosuchtenant', body: saleBody })
    );
    const body = bodyOf(result);

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe('error');
    expect(body.reason).toContain('unknown tenant "nosuchtenant"');
    expect(body.knownTenantIds).toEqual(['a', 'b']);
    expect(handler.calls).toHaveLength(0);
  });

  it('reports an unresolvable tenant', async () => {
    const lambda = lambdaFor(new RecordingHandler(), [
      tenant('a'),
      tenant('b'),
    ]);

    const body = bodyOf(
      await lambda(makeEvent({ rawPath: '/', body: saleBody }))
    );
    expect(body.status).toBe('error');
    expect(body.reason).toContain('could not resolve a tenant');
  });
});

describe('createTransactionLambda — request handling', () => {
  it('ignores a request with no body', async () => {
    const handler = new RecordingHandler();
    const lambda = lambdaFor(handler, [tenant('a')]);

    const body = bodyOf(await lambda(makeEvent({ rawPath: '/a' })));
    expect(body.status).toBe('ignored');
    expect(body.reason).toBe('request has no body');
    expect(handler.calls).toHaveLength(0);
  });

  it('reports an unparseable body', async () => {
    const handler = new RecordingHandler();
    const lambda = lambdaFor(handler, [tenant('a')]);

    const body = bodyOf(
      await lambda(makeEvent({ rawPath: '/a', body: '{broken' }))
    );
    expect(body.status).toBe('error');
    expect(body.reason).toContain('could not parse body');
    expect(handler.calls).toHaveLength(0);
  });

  it('reports a failed tenant initialization', async () => {
    const lambda = lambdaFor(new RecordingHandler(), [
      {
        tenantId: 'a',
        baseUrl: 'https://a.retail.heartland.us',
        getToken: async () => {
          throw new Error('secret unavailable');
        },
      },
    ]);

    const body = bodyOf(
      await lambda(makeEvent({ rawPath: '/a', body: saleBody }))
    );
    expect(body.status).toBe('error');
    expect(body.reason).toContain('tenant initialization failed');
    expect(body.reason).toContain('secret unavailable');
  });

  it('skips an unsupported event without loading the tenant token', async () => {
    const getToken = jest.fn(async () => 'token');
    const handler = new RecordingHandler('a', undefined, false);
    const lambda = lambdaFor(handler, [
      { tenantId: 'a', baseUrl: 'https://a.retail.heartland.us', getToken },
    ]);

    const body = bodyOf(
      await lambda(makeEvent({ rawPath: '/a', body: saleBody }))
    );
    expect(body.status).toBe('ignored');
    expect(body.reason).toBe('handler does not support this event');
    expect(handler.calls).toHaveLength(0);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('contains a thrown handler error as a 200 with status error', async () => {
    const handler = new RecordingHandler(
      'inventory-checks',
      new Error('strategy blew up')
    );
    const lambda = lambdaFor(handler, [tenant('a')]);

    const result = await lambda(makeEvent({ rawPath: '/a', body: saleBody }));
    const body = bodyOf(result);

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe('error');
    expect(body.reason).toContain('strategy blew up');
    expect(body.handler).toBe('inventory-checks');
  });

  it('echoes the handler outcome and details', async () => {
    const handler = new RecordingHandler('inventory-checks', {
      ok: false,
      details: { failedChecks: ['inventory-non-negative'] },
    });
    const lambda = lambdaFor(handler, [tenant('a')]);

    const body = bodyOf(
      await lambda(makeEvent({ rawPath: '/a', body: saleBody }))
    );
    expect(body.status).toBe('error');
    expect(body.ok).toBe(false);
    expect(body.handler).toBe('inventory-checks');
    expect(body.details).toEqual({
      failedChecks: ['inventory-non-negative'],
    });
  });

  it('treats a void return as success and describes the transaction', async () => {
    const lambda = lambdaFor(new RecordingHandler(), [tenant('a')]);

    const body = bodyOf(
      await lambda(makeEvent({ rawPath: '/a', body: saleBody }))
    );
    expect(body.status).toBe('ok');
    expect(body.ok).toBe(true);
    expect(body.transactionId).toBe(77);
    expect(body.transactionType).toBe('Ticket');
    expect(body.transactionKind).toBe('sale');
  });

  it('passes the parsed transaction through to the handler', async () => {
    const handler = new RecordingHandler();
    const lambda = lambdaFor(handler, [tenant('a')]);

    await lambda(
      makeEvent({
        rawPath: '/a',
        body: JSON.stringify({
          id: 5,
          type: 'Return',
          total: -10,
          total_discounts: 2,
        }),
      })
    );

    expect(handler.calls[0].tx.id).toBe(5);
    expect(handler.calls[0].tx.type).toBe('Return');
    expect(handler.calls[0].tx.total_discounts).toBe(2);
  });
});
