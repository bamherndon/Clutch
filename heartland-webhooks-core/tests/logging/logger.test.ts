import {
  ConsoleLogger,
  NoopLogger,
  safeStringify,
} from '../../src/logging/logger';

describe('ConsoleLogger', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefixes every line with its tags', () => {
    new ConsoleLogger(['clutch']).child('bamherndon').info('hello');
    expect(log).toHaveBeenCalledWith('[clutch][bamherndon] hello');
  });

  it('routes warn and error to the matching console method', () => {
    const logger = new ConsoleLogger();
    logger.warn('careful');
    logger.error('broken');
    expect(warn).toHaveBeenCalledWith('careful');
    expect(error).toHaveBeenCalledWith('broken');
  });

  it('suppresses debug unless enabled', () => {
    new ConsoleLogger([], false).debug('quiet');
    expect(log).not.toHaveBeenCalled();

    new ConsoleLogger([], true).debug('loud');
    expect(log).toHaveBeenCalledWith('loud');
  });

  it('keeps the debug setting across child loggers', () => {
    new ConsoleLogger(['a'], true).child('b').debug('loud');
    expect(log).toHaveBeenCalledWith('[a][b] loud');
  });

  it('stringifies detail arguments', () => {
    new ConsoleLogger().info('with detail', { a: 1 });
    expect(log).toHaveBeenCalledWith('with detail', '{\n  "a": 1\n}');
  });
});

describe('NoopLogger', () => {
  it('discards everything and returns itself as a child', () => {
    const logger = new NoopLogger();
    expect(logger.child('x')).toBe(logger);
    expect(() => logger.info('ignored')).not.toThrow();
  });
});

describe('safeStringify', () => {
  it('passes strings through', () => {
    expect(safeStringify('plain')).toBe('plain');
  });

  it('renders an error with its stack', () => {
    const err = new Error('boom');
    expect(safeStringify(err)).toContain('boom');
  });

  it('degrades gracefully on circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => safeStringify(circular)).not.toThrow();
  });
});
