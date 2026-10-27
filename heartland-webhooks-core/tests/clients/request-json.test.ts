jest.mock('https');

import { EventEmitter } from 'events';
import * as https from 'https';
import { requestJson } from '../../src/clients/http';

const mockedRequest = https.request as unknown as jest.Mock;

/**
 * Exercises the single shared HTTP path by standing in for `https.request`.
 * Everything in this package funnels through it, so its status-code and
 * JSON-parsing behavior is worth pinning down directly.
 */

interface FakeResponse {
  statusCode?: number;
  chunks?: string[];
}

class FakeRequest extends EventEmitter {
  readonly written: string[] = [];
  ended = false;

  write(chunk: string): void {
    this.written.push(chunk);
  }

  end(): void {
    this.ended = true;
  }
}

let lastRequest: FakeRequest;
let lastUrl: string | undefined;
let lastOptions: https.RequestOptions | undefined;

function mockHttps(response: FakeResponse | Error): void {
  mockedRequest.mockImplementation(
    (
      url: string,
      options: https.RequestOptions,
      callback: (res: EventEmitter & { statusCode?: number }) => void
    ) => {
      lastUrl = url;
      lastOptions = options;
      const req = new FakeRequest();
      lastRequest = req;

      // Deliver asynchronously, as the real client does.
      setImmediate(() => {
        if (response instanceof Error) {
          req.emit('error', response);
          return;
        }
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number;
        };
        res.statusCode = response.statusCode ?? 200;
        callback(res);
        for (const chunk of response.chunks ?? []) {
          res.emit('data', chunk);
        }
        res.emit('end');
      });

      return req;
    }
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('requestJson', () => {
  it('resolves the parsed body on 2xx', async () => {
    mockHttps({ statusCode: 200, chunks: ['{"id":', '7}'] });

    await expect(
      requestJson<{ id: number }>('https://x.test/api', { token: 'tok' })
    ).resolves.toEqual({ id: 7 });
  });

  it('resolves an empty object when the body is empty', async () => {
    mockHttps({ statusCode: 204, chunks: [] });
    await expect(requestJson('https://x.test/api')).resolves.toEqual({});
  });

  it('sends a bearer Authorization header', async () => {
    mockHttps({ statusCode: 200, chunks: ['{}'] });
    await requestJson('https://x.test/api', { token: 'tok' });

    expect(lastUrl).toBe('https://x.test/api');
    expect(lastOptions?.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
  });

  it('passes a pre-built Authorization header through unchanged', async () => {
    mockHttps({ statusCode: 200, chunks: ['{}'] });
    await requestJson('https://x.test/api', {
      authorization: 'OAuth oauth_consumer_key="k"',
    });

    expect(lastOptions?.headers).toMatchObject({
      Authorization: 'OAuth oauth_consumer_key="k"',
    });
  });

  it('omits Authorization when no credentials are given', async () => {
    mockHttps({ statusCode: 200, chunks: ['{}'] });
    await requestJson('https://x.test/api');
    expect(lastOptions?.headers).not.toHaveProperty('Authorization');
  });

  it('writes the serialized body and sets Content-Length', async () => {
    mockHttps({ statusCode: 200, chunks: ['{}'] });
    await requestJson('https://x.test/api', {
      method: 'POST',
      body: { status: 'accepted' },
    });

    expect(lastOptions?.method).toBe('POST');
    expect(lastRequest.written).toEqual(['{"status":"accepted"}']);
    expect(lastRequest.ended).toBe(true);
    expect(lastOptions?.headers).toMatchObject({
      'Content-Length': String('{"status":"accepted"}'.length),
    });
  });

  it('sends no body and no Content-Length for a GET', async () => {
    mockHttps({ statusCode: 200, chunks: ['{}'] });
    await requestJson('https://x.test/api');

    expect(lastRequest.written).toEqual([]);
    expect(lastOptions?.headers).not.toHaveProperty('Content-Length');
  });

  it('lets caller headers override the defaults', async () => {
    mockHttps({ statusCode: 200, chunks: ['{}'] });
    await requestJson('https://x.test/api', {
      headers: { Accept: 'application/json', 'Content-Type': 'text/plain' },
    });

    expect(lastOptions?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'text/plain',
    });
  });

  it('rejects on a non-2xx status, including the body and api label', async () => {
    mockHttps({ statusCode: 422, chunks: ['{"error":"bad qty"}'] });

    await expect(
      requestJson('https://x.test/api', { api: 'Heartland API' })
    ).rejects.toThrow('HTTP 422 from Heartland API: {"error":"bad qty"}');
  });

  it('rejects when the 2xx body is not valid JSON', async () => {
    mockHttps({ statusCode: 200, chunks: ['<html>nope</html>'] });
    await expect(requestJson('https://x.test/api')).rejects.toThrow();
  });

  it('rejects on a transport error', async () => {
    mockHttps(new Error('ECONNRESET'));
    await expect(requestJson('https://x.test/api')).rejects.toThrow(
      'ECONNRESET'
    );
  });
});
