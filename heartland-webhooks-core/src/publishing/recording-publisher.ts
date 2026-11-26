import { EventPublisher, ParkedTrigger, QueueMessage } from './types';

/** How a {@link RecordingPublisher} should misbehave, if at all. */
export interface RecordingPublisherOptions {
  /** Thrown by `publish()`, to exercise the park-the-trigger path. */
  publishError?: unknown;
  /**
   * Thrown by `park()`, to exercise the one path where an event is genuinely
   * lost and the log line has to be loud about it.
   */
  parkError?: unknown;
}

/**
 * In-memory {@link EventPublisher} for tests: records what was published and
 * what was parked, and can be configured to fail either.
 *
 * It ships in `src/` rather than `tests/` because the dispatcher and the tenant
 * packages are separate workspaces and would otherwise each write their own
 * copy — and a fake that drifts from the interface it stands in for is worse
 * than no fake.
 *
 * A failed call is still recorded. Whether publishing was *attempted* is the
 * thing under test on the failure paths, and a fake that swallowed the attempt
 * would make "did it try, then park?" unassertable.
 */
export class RecordingPublisher implements EventPublisher {
  readonly published: QueueMessage[] = [];
  readonly parked: ParkedTrigger[] = [];

  constructor(private readonly options: RecordingPublisherOptions = {}) {}

  async publish(message: QueueMessage): Promise<void> {
    this.published.push(message);
    if (this.options.publishError !== undefined) {
      throw this.options.publishError;
    }
  }

  async park(trigger: ParkedTrigger): Promise<void> {
    this.parked.push(trigger);
    if (this.options.parkError !== undefined) {
      throw this.options.parkError;
    }
  }

  /** The only published message, asserting there was exactly one. */
  get onlyPublished(): QueueMessage {
    if (this.published.length !== 1) {
      throw new Error(
        `Expected exactly one published message, got ${this.published.length}`
      );
    }
    return this.published[0];
  }

  /** The only parked trigger, asserting there was exactly one. */
  get onlyParked(): ParkedTrigger {
    if (this.parked.length !== 1) {
      throw new Error(
        `Expected exactly one parked trigger, got ${this.parked.length}`
      );
    }
    return this.parked[0];
  }

  reset(): void {
    this.published.length = 0;
    this.parked.length = 0;
  }
}
