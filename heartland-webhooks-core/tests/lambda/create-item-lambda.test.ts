import { HeartlandApiClient } from '../../src/clients/heartland-api-client';
import { ItemHandler, WebhookOutcome } from '../../src/handlers/handler';
import { createItemLambda } from '../../src/lambda/create-item-lambda';
import { NoopLogger } from '../../src/logging/logger';
import { HeartlandItemCreatedPayload } from '../../src/model/item';
import { fromHeader } from '../../src/tenancy/resolver';
import { TenantConfig, TenantContext } from '../../src/tenancy/tenant';
import { bodyOf, makeEvent } from '../helpers/event';

const fakeClient = {} as HeartlandApiClient;
const clientFactory = () => fakeClient;

/** One multi-tenant item handler, recording the context of each call. */
class RecordingItemHandler implements ItemHandler {
  readonly calls: Array<{
    item: HeartlandItemCreatedPayload;
    context: TenantContext;
  }> = [];

  constructor(
    readonly name = 'recording-items',
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
  it('routes by header to one shared handler, with per-tenant contexts', async () => {
    const handler = new RecordingItemHandler();
    const lambda = createItemLambda({
      handler,
      tenants: [tenant('bamherndon'), tenant('otherstore')],
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
    await lambda(
      makeEvent({
        headers: { 'x-clutch-tenant': 'bamherndon' },
        body: itemBody,
      })
    );

    expect(body.status).toBe('ok');
    expect(body.tenantId).toBe('otherstore');
    expect(handler.tenantIds).toEqual(['otherstore', 'bamherndon']);
    expect(handler.calls[0].context.heartland).toBe(fakeClient);
  });

  it('hands the handler a normalized, camelCased payload', async () => {
    const handler = new RecordingItemHandler();
    const lambda = createItemLambda({
      handler,
      tenants: [tenant('a')],
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
      handler: new RecordingItemHandler(),
      tenants: [tenant('a')],
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(await lambda(makeEvent({ body: itemBody })));
    expect(body.itemId).toBe(909);
    expect(body.department).toBe('Minifigs');
    expect(body.subDepartment).toBe('New In Box');
  });

  it('contains a thrown handler error', async () => {
    const lambda = createItemLambda({
      handler: new RecordingItemHandler(
        'items',
        new Error('bricklink unreachable')
      ),
      tenants: [tenant('a')],
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
      handler: new RecordingItemHandler(),
      tenants: [tenant('a')],
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(await lambda(makeEvent({ body: '{nope' })));
    expect(body.status).toBe('error');
    expect(body.reason).toContain('could not parse body');
  });

  it('serves a tenant configured without getToken until Heartland is called', async () => {
    const handler = new RecordingItemHandler();
    const lambda = createItemLambda({
      handler,
      tenants: [{ tenantId: 'a', baseUrl: 'https://a.retail.heartland.us' }],
      logger: new NoopLogger(),
      clientFactory,
    });

    const body = bodyOf(await lambda(makeEvent({ body: itemBody })));
    expect(body.status).toBe('ok');

    await expect(
      handler.calls[0].context.heartland.getInventoryItem(1)
    ).rejects.toThrow('Tenant "a" has no getToken configured');
  });
});
