import { HeartlandApiClient } from '../../src/clients/heartland-api-client';
import { TenantRegistry } from '../../src/tenancy/registry';
import { TenantConfig, UnknownTenantError } from '../../src/tenancy/tenant';

const fakeClient = {} as HeartlandApiClient;
const clientFactory = () => fakeClient;

function tenant(
  tenantId: string,
  getToken?: () => Promise<string>
): TenantConfig {
  return {
    tenantId,
    baseUrl: `https://${tenantId}.retail.heartland.us`,
    getToken,
  };
}

describe('TenantRegistry', () => {
  it('rejects duplicate tenant ids', () => {
    expect(
      () =>
        new TenantRegistry(
          [tenant('a', async () => 't'), tenant('a', async () => 't')],
          { clientFactory }
        )
    ).toThrow('Duplicate tenantId "a"');
  });

  it('reports the sole tenant only when exactly one is registered', () => {
    expect(
      new TenantRegistry([tenant('a', async () => 't')], { clientFactory })
        .soleTenantId
    ).toBe('a');

    expect(
      new TenantRegistry(
        [tenant('a', async () => 't'), tenant('b', async () => 't')],
        { clientFactory }
      ).soleTenantId
    ).toBeUndefined();
  });

  it('builds a context carrying the tenant identity and client', async () => {
    const registry = new TenantRegistry(
      [tenant('bamherndon', async () => 'token-1')],
      { clientFactory }
    );

    const context = await registry.context('bamherndon');
    expect(context.tenantId).toBe('bamherndon');
    expect(context.baseUrl).toBe('https://bamherndon.retail.heartland.us');
    expect(context.heartland).toBe(fakeClient);
  });

  it('passes each tenant its own base URL and token to the client factory', async () => {
    const built: Array<[string, string]> = [];
    const registry = new TenantRegistry(
      [
        tenant('a', async () => 'token-a'),
        tenant('b', async () => 'token-b'),
      ],
      {
        clientFactory: (baseUrl, token) => {
          built.push([baseUrl, token]);
          return fakeClient;
        },
      }
    );

    await registry.context('a');
    await registry.context('b');

    expect(built).toEqual([
      ['https://a.retail.heartland.us', 'token-a'],
      ['https://b.retail.heartland.us', 'token-b'],
    ]);
  });

  it('throws UnknownTenantError for unregistered and missing ids', async () => {
    const registry = new TenantRegistry([tenant('a', async () => 't')], {
      clientFactory,
    });

    await expect(registry.context('nope')).rejects.toThrow(UnknownTenantError);
    await expect(registry.context(undefined)).rejects.toThrow(
      UnknownTenantError
    );
  });

  it('loads each tenant token once and only for tenants that get traffic', async () => {
    const getTokenA = jest.fn(async () => 'token-a');
    const getTokenB = jest.fn(async () => 'token-b');

    const registry = new TenantRegistry(
      [tenant('a', getTokenA), tenant('b', getTokenB)],
      { clientFactory }
    );

    await registry.context('a');
    await registry.context('a');
    await registry.context('a');

    expect(getTokenA).toHaveBeenCalledTimes(1);
    expect(getTokenB).not.toHaveBeenCalled();
  });

  it('does not cache a failed token load', async () => {
    const getToken = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('secrets manager down'))
      .mockResolvedValueOnce('token-ok');

    const registry = new TenantRegistry([tenant('a', getToken)], {
      clientFactory,
    });

    await expect(registry.context('a')).rejects.toThrow('secrets manager down');

    const context = await registry.context('a');
    expect(context.tenantId).toBe('a');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty token', async () => {
    const registry = new TenantRegistry([tenant('a', async () => '')], {
      clientFactory,
    });
    await expect(registry.context('a')).rejects.toThrow(
      'empty Heartland token'
    );
  });
});

describe('TenantRegistry — tenant without getToken', () => {
  it('builds a context without calling the client factory', async () => {
    const factory = jest.fn(() => fakeClient);
    const registry = new TenantRegistry([tenant('a')], {
      clientFactory: factory,
    });

    const context = await registry.context('a');
    expect(context.tenantId).toBe('a');
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects any Heartland call, naming the tenant and the method', async () => {
    const registry = new TenantRegistry([tenant('a')], {
      clientFactory,
    });

    const { heartland } = await registry.context('a');
    await expect(heartland.getTicketLines(1)).rejects.toThrow(
      'Tenant "a" has no getToken configured, so getTicketLines() cannot call the Heartland API'
    );
    await expect(heartland.updateInventoryItem(1, {})).rejects.toThrow(
      'updateInventoryItem() cannot call the Heartland API'
    );
  });

  // The stand-in is a Proxy. If it answered `then`, it would look like a
  // promise and `await`ing it would hang instead of yielding the client.
  it('is not thenable', async () => {
    const registry = new TenantRegistry([tenant('a')], { clientFactory });
    const { heartland } = await registry.context('a');

    expect((heartland as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(heartland)).resolves.toBe(heartland);
  });
});
