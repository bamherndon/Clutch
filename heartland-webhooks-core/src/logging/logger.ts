/**
 * Minimal logging seam so core and plugins emit consistently tagged lines, and
 * so tests can assert on output without spying on `console`.
 */
export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
  /** Derive a logger that prefixes every line with an additional tag. */
  child(tag: string): Logger;
}

type ConsoleMethod = 'log' | 'warn' | 'error';

/**
 * Logger backed by `console`, which is what CloudWatch captures.
 *
 * `debug` lines are suppressed unless `debugEnabled` is set, so the verbose
 * per-line receipt/inventory tracing can stay in the code without flooding
 * production logs.
 */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly tags: string[] = [],
    private readonly debugEnabled: boolean = false
  ) {}

  debug(message: string, detail?: unknown): void {
    if (this.debugEnabled) {
      this.write('log', message, detail);
    }
  }

  info(message: string, detail?: unknown): void {
    this.write('log', message, detail);
  }

  warn(message: string, detail?: unknown): void {
    this.write('warn', message, detail);
  }

  error(message: string, detail?: unknown): void {
    this.write('error', message, detail);
  }

  child(tag: string): Logger {
    return new ConsoleLogger([...this.tags, tag], this.debugEnabled);
  }

  private write(method: ConsoleMethod, message: string, detail?: unknown): void {
    const prefix = this.tags.map((tag) => `[${tag}]`).join('');
    const line = prefix ? `${prefix} ${message}` : message;
    if (detail === undefined) {
      console[method](line);
      return;
    }
    console[method](line, safeStringify(detail));
  }
}

/**
 * Logger that discards everything — the default for tests.
 */
export class NoopLogger implements Logger {
  debug(_message: string, _detail?: unknown): void {}
  info(_message: string, _detail?: unknown): void {}
  warn(_message: string, _detail?: unknown): void {}
  error(_message: string, _detail?: unknown): void {}
  child(_tag?: string): Logger {
    return this;
  }
}

/**
 * Pretty-print a value for logs, degrading gracefully on circular structures.
 */
export function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
