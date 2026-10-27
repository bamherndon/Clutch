import {
  buildQueryString,
  buildUrl,
  requestJson,
} from '../../src/clients/http';

describe('buildUrl', () => {
  it('joins tolerating slashes on either side', () => {
    expect(buildUrl('https://x.test/', '/api/items')).toBe(
      'https://x.test/api/items'
    );
    expect(buildUrl('https://x.test', 'api/items')).toBe(
      'https://x.test/api/items'
    );
    expect(buildUrl('https://x.test///', '/api')).toBe('https://x.test/api');
  });
});

describe('buildQueryString', () => {
  it('repeats the key for array values', () => {
    expect(buildQueryString({ 'group[]': ['a', 'b'] })).toBe(
      'group%5B%5D=a&group%5B%5D=b'
    );
  });

  it('skips undefined values but keeps false and zero', () => {
    expect(
      buildQueryString({ a: undefined, b: false, c: 0, d: 'x' })
    ).toBe('b=false&c=0&d=x');
  });

  it('returns an empty string for an empty query', () => {
    expect(buildQueryString({})).toBe('');
  });
});

describe('requestJson', () => {
  it('rejects when both token and authorization are supplied', async () => {
    await expect(
      requestJson('https://x.test', { token: 'a', authorization: 'OAuth b' })
    ).rejects.toThrow('not both');
  });
});
