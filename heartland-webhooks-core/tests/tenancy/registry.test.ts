import { HeartlandApiClient } from '../../src/clients/heartland-api-client';
import { TenantRegistry } from '../../src/tenancy/registry';
import { TenantDefinition, UnknownTenantError } from '../../src/tenancy/tenant';

const fakeClient = {} as HeartlandApiClient;
const clientFactory = () => fakeClient;

function tenant(
  tenantId: string,
  getToken: () => Promise<string>
): TenantDefinition<string> {
  return {
    tenantId,
    baseUrl: `https://${tenantId}.retail.heartland.us`,
    getToken,
    handler: `${tenantId}-handler`,
  };
}

describe('TenantRegistry', () => {
  it('rejects duplicate tenant ids', () => {
    expect(
      () =>
        new TenantRegistry(
          [
            tenant('a', async () => 't'),
            tenant('a', async () => 't'),
          ],
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

  it('resolves a tenant to its handler and context', async () => {
    const registry = new TenantRegistry(
      [tenant('bamherndon', async () => 'token-1')],
      { clientFactory }
    );

    const { handler, context } = await registry.resolve('bamherndon');
    expect(handler).toBe('bamherndon-handler');
    expect(context.tenantId).toBe('bamherndon');
    expect(context.baseUrl).toBe('https://bamherndon.retail.heartland.us');
    expect(context.heartland).toBe(fakeClient);
  });

  it('throws UnknownTenantError for unregistered and missing ids', async () => {
    const registry = new TenantRegistry([tenant('a', async () => 't')], {
      clientFactory,
    });

    await expect(registry.resolve('nope')).rejects.toThrow(UnknownTenantError);
    await expect(registry.resolve(undefined)).rejects.toThrow(
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

    await registry.resolve('a');
    await registry.resolve('a');
    await registry.resolve('a');

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

    await expect(registry.resolve('a')).rejects.toThrow('secrets manager down');

    const { context } = await registry.resolve('a');
    expect(context.tenantId).toBe('a');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty token', async () => {
    const registry = new TenantRegistry([tenant('a', async () => '')], {
      clientFactory,
    });
    await expect(registry.resolve('a')).rejects.toThrow('empty Heartland token');
  });
});
