import { buildQueueMessage } from '../../src/publishing/build-queue-message';
import { RecordingPublisher } from '../../src/publishing/recording-publisher';
import { EventPublisher } from '../../src/publishing/types';

function message(recordId: number) {
  return buildQueueMessage({
    eventType: 'item_created',
    tenantId: 'bamherndon',
    recordId,
    record: { id: recordId },
    receivedAt: new Date('2026-11-26T15:04:05.000Z'),
    fetchedAt: new Date('2026-11-26T15:04:05.250Z'),
  });
}

const trigger = {
  schemaVersion: 1 as const,
  eventType: 'item_created',
  tenantId: 'bamherndon',
  recordId: 7,
  reason: 'fetch failed',
  receivedAt: '2026-11-26T15:04:05.000Z',
};

describe('RecordingPublisher', () => {
  it('is usable wherever an EventPublisher is expected', async () => {
    const publisher: EventPublisher = new RecordingPublisher();
    await expect(publisher.publish(message(1))).resolves.toBeUndefined();
    await expect(publisher.park(trigger)).resolves.toBeUndefined();
  });

  it('records published messages in order', async () => {
    const publisher = new RecordingPublisher();

    await publisher.publish(message(1));
    await publisher.publish(message(2));

    expect(publisher.published.map((m) => m.recordId)).toEqual([1, 2]);
    expect(publisher.parked).toEqual([]);
  });

  it('records parked triggers separately from published messages', async () => {
    const publisher = new RecordingPublisher();

    await publisher.park(trigger);

    expect(publisher.onlyParked).toEqual(trigger);
    expect(publisher.published).toEqual([]);
  });

  it('throws the configured publish error, having recorded the attempt', async () => {
    const publisher = new RecordingPublisher({
      publishError: new Error('sqs unavailable'),
    });

    await expect(publisher.publish(message(1))).rejects.toThrow(
      'sqs unavailable'
    );
    expect(publisher.published).toHaveLength(1);
  });

  it('throws the configured park error', async () => {
    const publisher = new RecordingPublisher({
      parkError: new Error('core DLQ unavailable'),
    });

    await expect(publisher.park(trigger)).rejects.toThrow(
      'core DLQ unavailable'
    );
    expect(publisher.parked).toHaveLength(1);
  });

  it('fails an assertion rather than returning the wrong message', () => {
    const publisher = new RecordingPublisher();

    expect(() => publisher.onlyPublished).toThrow(
      'Expected exactly one published message, got 0'
    );
    expect(() => publisher.onlyParked).toThrow(
      'Expected exactly one parked trigger, got 0'
    );
  });

  it('returns the only message once there is exactly one', async () => {
    const publisher = new RecordingPublisher();
    await publisher.publish(message(9));
    expect(publisher.onlyPublished.recordId).toBe(9);
  });

  it('clears both records on reset', async () => {
    const publisher = new RecordingPublisher();
    await publisher.publish(message(1));
    await publisher.park(trigger);

    publisher.reset();

    expect(publisher.published).toEqual([]);
    expect(publisher.parked).toEqual([]);
  });
});
