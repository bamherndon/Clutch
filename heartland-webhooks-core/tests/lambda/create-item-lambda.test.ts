import { HeartlandApiClient } from '../../src/clients/heartland-api-client';
import { ItemHandler, WebhookOutcome } from '../../src/handlers/handler';
import { createItemLambda } from '../../src/lambda/create-item-lambda';
import { NoopLogger } from '../../src/logging/logger';
import { HeartlandItemCreatedPayload } from '../../src/model/item';
import { fromHeader } from '../../src/tenancy/resolver';
import { TenantContext, TenantDefinition } from '../../src/tenancy/tenant';
import { bodyOf, makeEvent } from '../helpers/event';

const fakeClient = {} as HeartlandApiClient;
const clientFactory = () => fakeClient;

class RecordingItemHandler implements ItemHandler {
  readonly calls: Array<{
    item: HeartlandItemCreatedPayload;
    context: TenantContext;
  }> = [];

  constructor(
    readonly name: string,
    private readonly outcome: WebhookOutcome | Error | undefined = undefined
  ) {}

  async handleItemCreated(
    item: HeartlandItemCreatedPayload,
    context: TenantContext
  ): Promise<WebhookOutcome | void> {
    this.calls.push({ item, context });
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

function tenantFor(
  tenantId: string,
  handler: ItemHandler
): TenantDefinition<ItemHandler> {
  return {
    tenantId,
    baseUrl: `https://${tenantId}.retail.heartland.us`,
    getToken: async () => `${tenantId}-token`,
    handler,
  };
}

const itemBody = JSON.stringify({
  id: 909,
  public_id: 'SET-909',
  custom: {
    department: 'Minifigs',
    sub_department: 'New In Box',
    bricklink_id: 'sw0001a-1',
  },
});

describe('createItemLambda', () => {
  it('routes by header and injects the tenant context', async () => {
    const herndon = new RecordingItemHandler('herndon-items');
    const other = new RecordingItemHandler('other-items');

    const lambda = createItemLambda({
      tenants: [tenantFor('bamherndon', herndon), tenantFor('otherstore', other)],
      resolveTenant: fromHeader('x-clutch-tenant'),
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(
      await lambda(
        makeEvent({
          headers: { 'x-clutch-tenant': 'otherstore' },
          body: itemBody,
        })
      )
    );

    expect(body.status).toBe('ok');
    expect(body.tenantId).toBe('otherstore');
    expect(herndon.calls).toHaveLength(0);
    expect(other.calls).toHaveLength(1);
    expect(other.calls[0].context.tenantId).toBe('otherstore');
    expect(other.calls[0].context.heartland).toBe(fakeClient);
  });

  it('hands the handler a normalized, camelCased payload', async () => {
    const handler = new RecordingItemHandler('items');
    const lambda = createItemLambda({
      tenants: [tenantFor('a', handler)],
      logger: new NoopLogger(),
      clientFactory,
    });

    await lambda(makeEvent({ body: itemBody }));

    const item = handler.calls[0].item;
    expect(item.id).toBe(909);
    expect(item.publicId).toBe('SET-909');
    expect(item.custom?.subDepartment).toBe('New In Box');
    expect(item.custom?.bricklinkId).toBe('sw0001a-1');
  });

  it('describes the item in the response body', async () => {
    const lambda = createItemLambda({
      tenants: [tenantFor('a', new RecordingItemHandler('items'))],
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(await lambda(makeEvent({ body: itemBody })));
    expect(body.itemId).toBe(909);
    expect(body.department).toBe('Minifigs');
    expect(body.subDepartment).toBe('New In Box');
  });

  it('contains a thrown handler error', async () => {
    const handler = new RecordingItemHandler(
      'items',
      new Error('bricklink unreachable')
    );
    const lambda = createItemLambda({
      tenants: [tenantFor('a', handler)],
      logger: new NoopLogger(),
      clientFactory,
    });

    const result = await lambda(makeEvent({ body: itemBody }));
    const body = bodyOf(result);
    expect(result.statusCode).toBe(200);
    expect(body.status).toBe('error');
    expect(body.reason).toContain('bricklink unreachable');
  });

  it('reports an unparseable body', async () => {
    const lambda = createItemLambda({
      tenants: [tenantFor('a', new RecordingItemHandler('items'))],
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(await lambda(makeEvent({ body: '{nope' })));
    expect(body.status).toBe('error');
    expect(body.reason).toContain('could not parse body');
  });
});
