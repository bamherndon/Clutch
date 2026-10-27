jest.mock('../../src/clients/http', () => {
  const actual = jest.requireActual('../../src/clients/http');
  return { ...actual, requestJson: jest.fn() };
});

import { DefaultHeartlandApiClient } from '../../src/clients/heartland-api-client';
import { requestJson } from '../../src/clients/http';

const mockRequest = requestJson as jest.MockedFunction<typeof requestJson>;

const BASE = 'https://bamherndon.retail.heartland.us/';
const TOKEN = 'secret-token';

function client(): DefaultHeartlandApiClient {
  return new DefaultHeartlandApiClient(BASE, TOKEN);
}

/** The URL passed to requestJson on the Nth call. */
function urlOf(call = 0): string {
  return mockRequest.mock.calls[call][0];
}

/** The options passed to requestJson on the Nth call. */
function optsOf(call = 0): Record<string, unknown> {
  return (mockRequest.mock.calls[call][1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({} as never);
});

describe('DefaultHeartlandApiClient — request shaping', () => {
  it('sends a bearer token and trims the base URL slash', async () => {
    await client().getInventoryItem(42);
    expect(urlOf()).toBe('https://bamherndon.retail.heartland.us/api/items/42');
    expect(optsOf().token).toBe(TOKEN);
    expect(optsOf().api).toBe('Heartland API');
  });

  it('builds the ticket lines URL', async () => {
    await client().getTicketLines(7);
    expect(urlOf()).toContain('/api/sales/tickets/7/lines');
    expect(urlOf()).toContain('per_page=500');
  });

  it('builds the inventory values URL grouped by item and location', async () => {
    await client().getInventoryValues(123);
    expect(urlOf()).toContain('group[]=item_id');
    expect(urlOf()).toContain('group[]=location_id');
    expect(urlOf()).toContain('item_id=123');
    expect(urlOf()).toContain('exclude_empty_locations=true');
  });

  it('PUTs item updates', async () => {
    await client().updateInventoryItem(5, { custom: { tags: 'add, Star Wars' } });
    expect(optsOf().method).toBe('PUT');
    expect(optsOf().body).toEqual({ custom: { tags: 'add, Star Wars' } });
  });

  it('POSTs an image by URL', async () => {
    await client().updateInventoryItemImage(5, 'http://img.example/1.png');
    expect(urlOf()).toContain('/api/items/5/images');
    expect(optsOf().method).toBe('POST');
    expect(optsOf().body).toEqual({
      source: 'url',
      url: 'http://img.example/1.png',
    });
  });

  it('lists purchase orders by status and page', async () => {
    await client().listPurchaseOrders('open', 3);
    expect(urlOf()).toContain('status=open');
    expect(urlOf()).toContain('page=3');
  });

  it('completes a receipt by accepting it', async () => {
    await client().completeReceipt(88);
    expect(urlOf()).toContain('/api/purchasing/receipts/88');
    expect(optsOf().method).toBe('PUT');
    expect(optsOf().body).toEqual({ status: 'accepted' });
  });

  it('adds a request_client_uuid to every report call', async () => {
    await client().runReport('analyzer', { per_page: 10, 'group[]': ['a', 'b'] });

    const url = urlOf();
    expect(url).toContain('/api/reporting/analyzer?');
    expect(url).toContain('per_page=10');
    // Array values repeat the key.
    expect(url).toContain('group%5B%5D=a');
    expect(url).toContain('group%5B%5D=b');
    expect(url).toMatch(/request_client_uuid=[0-9a-f-]{36}/);
  });
});

describe('getReceiptByOrderId', () => {
  it('returns the first pending receipt', async () => {
    mockRequest.mockResolvedValueOnce({
      total: 1,
      pages: 1,
      results: [{ id: 501 }],
    } as never);

    const receipt = await client().getReceiptByOrderId(900);
    expect(receipt.id).toBe(501);
    expect(urlOf()).toContain('order_id=900');
    expect(urlOf()).toContain('status=pending');
  });

  it('throws when no pending receipt exists', async () => {
    mockRequest.mockResolvedValueOnce({
      total: 0,
      pages: 1,
      results: [],
    } as never);

    await expect(client().getReceiptByOrderId(900)).rejects.toThrow(
      'No pending receipt found for order_id 900'
    );
  });
});

describe('createReceiptFromPurchaseOrder', () => {
  it('copies every PO line with an item_id onto the new receipt', async () => {
    mockRequest
      // getPurchaseOrderLines
      .mockResolvedValueOnce({
        total: 3,
        pages: 1,
        results: [
          { id: 1, item_id: 11, qty: 2, unit_cost: 1.5 },
          { id: 2, item_id: null },
          { id: 3, item_id: 33, unit_cost: null },
        ],
      } as never)
      // createReceipt
      .mockResolvedValueOnce({} as never)
      // getReceiptByOrderId
      .mockResolvedValueOnce({
        total: 1,
        pages: 1,
        results: [{ id: 777 }],
      } as never)
      // addReceiptLine x2
      .mockResolvedValue({} as never);

    const receipt = await client().createReceiptFromPurchaseOrder(900, 4);
    expect(receipt.id).toBe(777);

    const lineBodies = mockRequest.mock.calls
      .map((call) => (call[1] ?? {}) as { body?: unknown })
      .map((opts) => opts.body)
      .filter(
        (body): body is { receipt_id: number } =>
          Boolean(body) &&
          typeof body === 'object' &&
          'receipt_id' in (body as object)
      );

    // The line with a null item_id is skipped; qty defaults to 0.
    expect(lineBodies).toEqual([
      { item_id: 11, qty: 2, receipt_id: 777, unit_cost: 1.5 },
      { item_id: 33, qty: 0, receipt_id: 777, unit_cost: null },
    ]);
  });

  it('propagates a failure adding a receipt line', async () => {
    mockRequest
      .mockResolvedValueOnce({
        total: 1,
        pages: 1,
        results: [{ id: 1, item_id: 11, qty: 1 }],
      } as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce({
        total: 1,
        pages: 1,
        results: [{ id: 777 }],
      } as never)
      .mockRejectedValueOnce(new Error('HTTP 422 from Heartland API'));

    await expect(
      client().createReceiptFromPurchaseOrder(900, 4)
    ).rejects.toThrow('HTTP 422');
  });
});
