import {
  firstOf,
  fixedTenant,
  fromHeader,
  fromPathParameter,
  fromPathSegment,
  fromQueryString,
} from '../../src/tenancy/resolver';
import { makeEvent } from '../helpers/event';

describe('fromPathSegment', () => {
  it('reads the requested segment, ignoring empty ones', () => {
    const event = makeEvent({ rawPath: '/bamherndon/transaction' });
    expect(fromPathSegment(0)(event)).toBe('bamherndon');
    expect(fromPathSegment(1)(event)).toBe('transaction');
  });

  it('tolerates trailing and doubled slashes', () => {
    expect(fromPathSegment(0)(makeEvent({ rawPath: '//bamherndon//' }))).toBe(
      'bamherndon'
    );
  });

  it('returns undefined when the segment is absent', () => {
    expect(fromPathSegment(0)(makeEvent({ rawPath: '/' }))).toBeUndefined();
    expect(fromPathSegment(3)(makeEvent({ rawPath: '/a/b' }))).toBeUndefined();
  });
});

describe('fromHeader', () => {
  it('matches the header case-insensitively', () => {
    const event = makeEvent({ headers: { 'X-Clutch-Tenant': 'otherstore' } });
    expect(fromHeader()(event)).toBe('otherstore');
  });

  it('treats a blank header as unresolved', () => {
    expect(fromHeader()(makeEvent({ headers: { 'x-clutch-tenant': '  ' } })))
      .toBeUndefined();
  });
});

describe('fromPathParameter and fromQueryString', () => {
  it('reads pathParameters', () => {
    const event = makeEvent({ pathParameters: { tenantId: 'bamherndon' } });
    expect(fromPathParameter()(event)).toBe('bamherndon');
  });

  it('reads the query string', () => {
    const event = makeEvent({ queryStringParameters: { tenant: 'xyz' } });
    expect(fromQueryString()(event)).toBe('xyz');
  });
});

describe('firstOf', () => {
  it('returns the first resolver that answers', () => {
    const resolve = firstOf(
      fromHeader(),
      fromPathSegment(0),
      fixedTenant('fallback')
    );

    expect(resolve(makeEvent({ headers: { 'x-clutch-tenant': 'a' } }))).toBe('a');
    expect(resolve(makeEvent({ rawPath: '/b/items' }))).toBe('b');
    expect(resolve(makeEvent())).toBe('fallback');
  });
});
