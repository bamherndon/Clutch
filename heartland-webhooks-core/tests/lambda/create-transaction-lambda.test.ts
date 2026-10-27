import { HeartlandApiClient } from '../../src/clients/heartland-api-client';
import {
  TransactionHandler,
  WebhookOutcome,
} from '../../src/handlers/handler';
import { createTransactionLambda } from '../../src/lambda/create-transaction-lambda';
import { NoopLogger } from '../../src/logging/logger';
import { HeartlandTransaction } from '../../src/model/transaction';
import { fromPathSegment } from '../../src/tenancy/resolver';
import { TenantContext, TenantDefinition } from '../../src/tenancy/tenant';
import { bodyOf, makeEvent } from '../helpers/event';

const fakeClient = {} as HeartlandApiClient;
const clientFactory = () => fakeClient;

/** Records what it was handed so tests can assert on the injected context. */
class RecordingHandler implements TransactionHandler {
  readonly calls: Array<{ tx: HeartlandTransaction; context: TenantContext }> =
    [];

  constructor(
    readonly name: string,
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
}

function tenantFor(
  tenantId: string,
  handler: TransactionHandler
): TenantDefinition<TransactionHandler> {
  return {
    tenantId,
    baseUrl: `https://${tenantId}.retail.heartland.us`,
    getToken: async () => `${tenantId}-token`,
    handler,
  };
}

const saleBody = JSON.stringify({ id: 77, type: 'Ticket', total: 25 });

function lambdaFor(
  tenants: TenantDefinition<TransactionHandler>[],
  resolveTenant = fromPathSegment(0)
) {
  return createTransactionLambda({
    tenants,
    resolveTenant,
    logger: new NoopLogger(),
    clientFactory,
  });
}

describe('createTransactionLambda — construction', () => {
  it('rejects an empty tenant list', () => {
    expect(() =>
      createTransactionLambda({ tenants: [], logger: new NoopLogger() })
    ).toThrow('no tenants registered');
  });

  it('requires a resolver when more than one tenant is registered', () => {
    expect(() =>
      createTransactionLambda({
        tenants: [
          tenantFor('a', new RecordingHandler('a')),
          tenantFor('b', new RecordingHandler('b')),
        ],
        logger: new NoopLogger(),
        clientFactory,
      })
    ).toThrow('resolveTenant is required');
  });

  it('defaults to the sole tenant when only one is registered', async () => {
    const handler = new RecordingHandler('solo');
    const lambda = createTransactionLambda({
      tenants: [tenantFor('solo', handler)],
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(await lambda(makeEvent({ body: saleBody })));
    expect(body.status).toBe('ok');
    expect(body.tenantId).toBe('solo');
    expect(handler.calls).toHaveLength(1);
  });
});

describe('createTransactionLambda — tenant routing', () => {
  it('routes each request to the matching tenant handler', async () => {
    const herndon = new RecordingHandler('herndon-checks');
    const other = new RecordingHandler('other-checks');
    const lambda = lambdaFor([
      tenantFor('bamherndon', herndon),
      tenantFor('otherstore', other),
    ]);

    await lambda(
      makeEvent({ rawPath: '/bamherndon/transaction', body: saleBody })
    );
    await lambda(
      makeEvent({ rawPath: '/otherstore/transaction', body: saleBody })
    );
    await lambda(
      makeEvent({ rawPath: '/otherstore/transaction', body: saleBody })
    );

    expect(herndon.calls).toHaveLength(1);
    expect(other.calls).toHaveLength(2);
  });

  it('gives each handler its own tenant context', async () => {
    const herndon = new RecordingHandler('herndon-checks');
    const other = new RecordingHandler('other-checks');
    const lambda = lambdaFor([
      tenantFor('bamherndon', herndon),
      tenantFor('otherstore', other),
    ]);

    await lambda(makeEvent({ rawPath: '/bamherndon', body: saleBody }));
    await lambda(makeEvent({ rawPath: '/otherstore', body: saleBody }));

    expect(herndon.calls[0].context.tenantId).toBe('bamherndon');
    expect(herndon.calls[0].context.baseUrl).toBe(
      'https://bamherndon.retail.heartland.us'
    );
    expect(other.calls[0].context.tenantId).toBe('otherstore');
    expect(other.calls[0].context.heartland).toBe(fakeClient);
  });

  it('reports an unknown tenant without invoking any handler', async () => {
    const handler = new RecordingHandler('a');
    const lambda = lambdaFor([
      tenantFor('a', handler),
      tenantFor('b', new RecordingHandler('b')),
    ]);

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
    const lambda = lambdaFor([
      tenantFor('a', new RecordingHandler('a')),
      tenantFor('b', new RecordingHandler('b')),
    ]);

    const body = bodyOf(await lambda(makeEvent({ rawPath: '/', body: saleBody })));
    expect(body.status).toBe('error');
    expect(body.reason).toContain('could not resolve a tenant');
  });
});

describe('createTransactionLambda — request handling', () => {
  it('ignores a request with no body', async () => {
    const handler = new RecordingHandler('a');
    const lambda = lambdaFor([tenantFor('a', handler)]);

    const body = bodyOf(await lambda(makeEvent({ rawPath: '/a' })));
    expect(body.status).toBe('ignored');
    expect(body.reason).toBe('request has no body');
    expect(handler.calls).toHaveLength(0);
  });

  it('reports an unparseable body', async () => {
    const handler = new RecordingHandler('a');
    const lambda = lambdaFor([tenantFor('a', handler)]);

    const body = bodyOf(
      await lambda(makeEvent({ rawPath: '/a', body: '{broken' }))
    );
    expect(body.status).toBe('error');
    expect(body.reason).toContain('could not parse body');
    expect(handler.calls).toHaveLength(0);
  });

  it('reports a failed tenant initialization', async () => {
    const lambda = lambdaFor([
      {
        tenantId: 'a',
        baseUrl: 'https://a.retail.heartland.us',
        getToken: async () => {
          throw new Error('secret unavailable');
        },
        handler: new RecordingHandler('a'),
      },
    ]);

    const body = bodyOf(await lambda(makeEvent({ rawPath: '/a', body: saleBody })));
    expect(body.status).toBe('error');
    expect(body.reason).toContain('tenant initialization failed');
    expect(body.reason).toContain('secret unavailable');
  });

  it('skips a handler that does not support the event', async () => {
    const handler = new RecordingHandler('a', undefined, false);
    const lambda = lambdaFor([tenantFor('a', handler)]);

    const body = bodyOf(await lambda(makeEvent({ rawPath: '/a', body: saleBody })));
    expect(body.status).toBe('ignored');
    expect(body.reason).toBe('handler does not support this event');
    expect(handler.calls).toHaveLength(0);
  });

  it('contains a thrown handler error as a 200 with status error', async () => {
    const handler = new RecordingHandler('a', new Error('strategy blew up'));
    const lambda = lambdaFor([tenantFor('a', handler)]);

    const result = await lambda(makeEvent({ rawPath: '/a', body: saleBody }));
    const body = bodyOf(result);

    expect(result.statusCode).toBe(200);
    expect(body.status).toBe('error');
    expect(body.reason).toContain('strategy blew up');
    expect(body.handler).toBe('a');
  });

  it('echoes the handler outcome and details', async () => {
    const handler = new RecordingHandler('inventory-checks', {
      ok: false,
      details: { failedChecks: ['inventory-non-negative'] },
    });
    const lambda = lambdaFor([tenantFor('a', handler)]);

    const body = bodyOf(await lambda(makeEvent({ rawPath: '/a', body: saleBody })));
    expect(body.status).toBe('error');
    expect(body.ok).toBe(false);
    expect(body.handler).toBe('inventory-checks');
    expect(body.details).toEqual({
      failedChecks: ['inventory-non-negative'],
    });
  });

  it('treats a void return as success and describes the transaction', async () => {
    const handler = new RecordingHandler('a');
    const lambda = lambdaFor([tenantFor('a', handler)]);

    const body = bodyOf(await lambda(makeEvent({ rawPath: '/a', body: saleBody })));
    expect(body.status).toBe('ok');
    expect(body.ok).toBe(true);
    expect(body.transactionId).toBe(77);
    expect(body.transactionType).toBe('Ticket');
    expect(body.transactionKind).toBe('sale');
  });

  it('passes the parsed transaction through to the handler', async () => {
    const handler = new RecordingHandler('a');
    const lambda = lambdaFor([tenantFor('a', handler)]);

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
