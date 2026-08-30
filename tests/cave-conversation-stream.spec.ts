import {
  CaveClient,
  caveConversationReconcileReason,
  createConversationEventTranslator,
  isCaveClientError,
  type CaveConversationEvent,
  type CaveTransport,
} from '@opencoven/cave-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { describe, expect, test, vi } from 'vitest';

const OPERATION_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const CONVERSATION_ID = 'conversation.v1';

function envelope(data: unknown): unknown {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['conversations', 'cursors'],
    operations: ['operations.events'],
    requestId: 'req-1',
    data,
  };
}

function envelopeError(
  code: string,
  message: string,
  details?: Record<string, string>,
): unknown {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['conversations'],
    operations: ['operations.events'],
    error: {
      code,
      message,
      retryable: false,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function operationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: OPERATION_ID,
    kind: 'messages.send',
    state: 'running',
    originatingScope: 'chat:write',
    conversationId: CONVERSATION_ID,
    inputTurnId: 'turn-1',
    latestEventId: 4,
    replayFloorEventId: 1,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:01.000Z',
    ...overrides,
  };
}

function completedOperation(latestEventId: number): unknown {
  return operationRecord({
    state: 'completed',
    outputTurnId: 'turn-2',
    latestEventId,
  });
}

function acceptedEvent(): unknown {
  return {
    type: 'operation.accepted',
    operationId: OPERATION_ID,
    eventId: 1,
    cursor: 'cursor-1',
    occurredAt: '2026-08-30T00:00:01.000Z',
    conversationId: CONVERSATION_ID,
    inputTurnId: 'turn-1',
  };
}

function deltaEvent(eventId: number, text: string): unknown {
  return {
    type: 'assistant.delta',
    operationId: OPERATION_ID,
    eventId,
    cursor: `cursor-${eventId}`,
    occurredAt: '2026-08-30T00:00:01.000Z',
    text,
  };
}

function completedEvent(eventId: number): unknown {
  return {
    type: 'operation.completed',
    operationId: OPERATION_ID,
    eventId,
    cursor: `cursor-${eventId}`,
    occurredAt: '2026-08-30T00:00:02.000Z',
    outputTurnId: 'turn-2',
  };
}

function runningPage(events: unknown[], latestEventId = 4, complete = false): unknown {
  return envelope({
    operation: operationRecord({ latestEventId }),
    events,
    complete,
  });
}

function completedPage(events: unknown[], latestEventId: number): unknown {
  return envelope({
    operation: completedOperation(latestEventId),
    events,
    complete: true,
  });
}

interface StreamHarness {
  client: CaveClient;
  reads: Array<{ cursor: string | undefined; deadline: number | undefined; aborted: boolean }>;
  stop: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function streamHarness(
  steps: Array<(context: OperationContext) => Promise<unknown>>,
): StreamHarness {
  const queue = [...steps];
  const reads: Array<{
    cursor: string | undefined;
    deadline: number | undefined;
    aborted: boolean;
  }> = [];
  const stop = vi.fn(() => {
    throw new Error('stop must never be called by the stream');
  });
  const send = vi.fn(() => {
    throw new Error('send must never be retried by the stream');
  });
  const readConversationOperationEvents = vi.fn(
    async (
      _operationId: string,
      pageRequest: { cursor?: string },
      context: OperationContext,
    ): Promise<unknown> => {
      const step = queue.shift();
      if (step === undefined) {
        throw new Error('unexpected extra event-page read');
      }
      const record = {
        cursor: pageRequest?.cursor,
        deadline: context.deadline,
        aborted: false,
      };
      reads.push(record);
      try {
        return await step(context);
      } catch (error) {
        record.aborted = true;
        throw error;
      }
    },
  );
  const transport = {
    health() {
      throw new Error('health is not expected in this test');
    },
    readConversationOperationEvents,
    stopConversationOperation: stop,
    sendConversationMessage: send,
  } as unknown as CaveTransport;
  return { client: new CaveClient({ transport }), reads, stop, send };
}

function delayThenPage(delayMs: number, page: unknown): () => Promise<unknown> {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return page;
  };
}

async function drain(
  stream: AsyncGenerator<CaveConversationEvent>,
): Promise<CaveConversationEvent[]> {
  const events: CaveConversationEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

describe('conversation event translator', () => {
  test('translates one initial page in wire order with typed events', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    const translated = translator.translate(
      runningPage([acceptedEvent(), deltaEvent(2, 'Hel'), deltaEvent(3, 'lo')]),
    );

    expect(translated.operation.id).toBe(OPERATION_ID);
    expect(translated.events.map((event) => event.type)).toEqual([
      'operation.accepted',
      'assistant.delta',
      'assistant.delta',
    ]);
    expect(translated.events[1]).toMatchObject({ type: 'assistant.delta', text: 'Hel' });
    expect(translated.complete).toBe(false);
  });

  test('suppresses an exact duplicate at or below the accepted cursor', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    const first = translator.translate(
      runningPage([acceptedEvent(), deltaEvent(2, 'Hel'), deltaEvent(3, 'lo')]),
    );
    expect(first.events.map((event) => event.eventId)).toEqual([1, 2, 3]);
    for (const event of first.events) {
      translator.commit(event.eventId);
    }
    expect(translator.deliveredThroughEventId).toBe(3);

    const second = translator.translate(
      runningPage([deltaEvent(3, 're-delivered'), deltaEvent(4, '!')]),
    );
    expect(second.events.map((event) => event.eventId)).toEqual([4]);
  });

  test('requires a fresh stream to begin at event 1', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    expect(() =>
      translator.translate(runningPage([deltaEvent(2, 'skipped one')])),
    ).toThrowError(/did not continue the event stream/u);
  });

  test('refuses a forward gap within a page', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(runningPage([deltaEvent(2, 'a'), deltaEvent(4, 'gap')], 8)),
    ).toThrowError(/was not contiguous/u);
  });

  test('refuses a forward gap across pages of one stream', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    translator.translate(runningPage([deltaEvent(2, 'baseline')], 8));
    translator.commit(2);

    expect(() =>
      translator.translate(runningPage([deltaEvent(4, 'gap')], 8)),
    ).toThrowError(/did not continue the event stream/u);
  });

  test('refuses events after the terminal event in the same page', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    const hostile = {
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: ['conversations', 'cursors'],
      operations: ['operations.events'],
      data: {
        operation: operationRecord({
          state: 'completed',
          outputTurnId: 'turn-2',
          latestEventId: 3,
        }),
        events: [acceptedEvent(), completedEvent(2), deltaEvent(3, 'after terminal')],
        complete: true,
      },
    };
    expect(() => translator.translate(hostile)).toThrowError(
      /after the terminal event/u,
    );
  });

  test('refuses a complete page for a non-terminal operation', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    expect(() =>
      translator.translate(
        {
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['conversations', 'cursors'],
          operations: ['operations.events'],
          data: {
            operation: operationRecord({ latestEventId: 2 }),
            events: [deltaEvent(1, 'a'), deltaEvent(2, 'b')],
            complete: true,
          },
        },
      ),
    ).toThrowError(/non-terminal operation/u);
  });

  test('refuses a complete page that stops short of the terminal event', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    const shortPage = {
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: ['conversations', 'cursors'],
      operations: ['operations.events'],
      data: {
        operation: completedOperation(4),
        events: [deltaEvent(1, 'a'), deltaEvent(2, 'b'), completedEvent(3)],
        complete: true,
      },
    };
    expect(() => translator.translate(shortPage)).toThrowError(
      /completed before the terminal event/u,
    );
  });

  test('reads a terminal-cursor page as complete with no events', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    const final = translator.translate(completedPage([], 4));
    expect(final.complete).toBe(true);
    expect(final.events).toEqual([]);
  });
});

describe('conversation route errors through the translator', () => {
  test('preserves the reconcile reason from the error envelope', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    let routeError: unknown;
    try {
      translator.translate(
        envelopeError('reconcile_required', 'Replay history is unavailable.', {
          reason: 'replay_gap',
        }),
      );
    } catch (error) {
      routeError = error;
    }
    expect((routeError as { code?: string }).code).toBe('reconcile_required');
    expect((routeError as { details?: Record<string, string> }).details?.reason).toBe(
      'replay_gap',
    );
  });
});

describe('streamConversationOperation', () => {
  test('yields typed events in order and terminates at completion without Stop or resend', async () => {
    const harness = streamHarness([
      () => Promise.resolve(runningPage([acceptedEvent(), deltaEvent(2, 'Hel'), deltaEvent(3, 'lo')], 4)),
      () => Promise.resolve(completedPage([completedEvent(4)], 4)),
    ]);

    const events = await drain(harness.client.streamConversationOperation(OPERATION_ID));

    expect(events.map((event) => event.type)).toEqual([
      'operation.accepted',
      'assistant.delta',
      'assistant.delta',
      'operation.completed',
    ]);
    expect(events[3]).toMatchObject({ type: 'operation.completed', outputTurnId: 'turn-2' });
    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
  });

  test('suppresses a duplicate re-delivered within one stream', async () => {
    const harness = streamHarness([
      () => Promise.resolve(runningPage([acceptedEvent(), deltaEvent(2, 'Hel'), deltaEvent(3, 'lo')], 4)),
      () => Promise.resolve(runningPage([deltaEvent(3, 'duplicate'), deltaEvent(4, '!')], 4)),
      () => Promise.resolve(completedPage([], 4)),
    ]);

    const events = await drain(harness.client.streamConversationOperation(OPERATION_ID));
    expect(events.map((event) => event.eventId)).toEqual([1, 2, 3, 4]);
    expect(harness.reads).toHaveLength(3);
  });

  test('terminates on an empty page when complete is true', async () => {
    const harness = streamHarness([
      () =>
        Promise.resolve(
          completedPage(
            [acceptedEvent(), deltaEvent(2, 'a'), deltaEvent(3, 'b'), completedEvent(4)],
            4,
          ),
        ),
      () => Promise.resolve(completedPage([], 4)),
    ]);

    const events = await drain(harness.client.streamConversationOperation(OPERATION_ID));

    expect(events).toHaveLength(4);
    expect(harness.reads).toHaveLength(1);
  });

  test('keeps polling an empty page while the operation is not complete', async () => {
    const harness = streamHarness([
      () => Promise.resolve(runningPage([], 4)),
      () => Promise.resolve(runningPage([acceptedEvent()], 4)),
      () => Promise.resolve(completedPage([completedEvent(2)], 2)),
    ]);

    const events = await drain(harness.client.streamConversationOperation(OPERATION_ID));

    expect(events.map((event) => event.eventId)).toEqual([1, 2]);
    expect(harness.reads).toHaveLength(3);
  });
});


describe('streamConversationOperation abort and resume', () => {
  test('a caller abort closes the in-flight read and the generator without Stop or resend', async () => {
    const controller = new AbortController();
    const harness = streamHarness([
      () => Promise.resolve(runningPage([acceptedEvent(), deltaEvent(2, 'Hel')], 4)),
      (context: OperationContext) =>
        new Promise<unknown>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new Error('read aborted')),
            { once: true },
          );
        }),
    ]);

    const iterator = harness.client
      .streamConversationOperation(OPERATION_ID, { signal: controller.signal }) [Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toMatchObject({ eventId: 1, type: 'operation.accepted' });
    const second = await iterator.next();
    expect(second.value).toMatchObject({ eventId: 2 });

    const third = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(harness.reads).toHaveLength(2);
    controller.abort();

    const closed = await third;
    expect(closed.done).toBe(true);
    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
  });
});


describe('streamConversationOperation resume', () => {
  test('emits only events after the supplied cursor on a resumed stream', async () => {
    const controller = new AbortController();
    const harness = streamHarness([
      () => Promise.resolve(runningPage([acceptedEvent(), deltaEvent(2, 'Hel')], 4)),
      () => Promise.resolve(runningPage([deltaEvent(3, 'lo'), deltaEvent(4, '!')], 4)),
      () => Promise.resolve(completedPage([], 4)),
    ]);

    const firstIterator = harness.client
      .streamConversationOperation(OPERATION_ID, { signal: controller.signal }) [Symbol.asyncIterator]();
    const firstResult = await firstIterator.next();
    expect(firstResult.value).toMatchObject({ eventId: 1 });
    const secondResult = await firstIterator.next();
    expect(secondResult.value).toMatchObject({ eventId: 2 });
    controller.abort();
    const firstClosed = await firstIterator.next();
    expect(firstClosed.done).toBe(true);

    const resumed = await drain(
      harness.client.streamConversationOperation(OPERATION_ID, {
        cursor: 'cursor-2',
      }),
    );
    expect(resumed.map((event) => event.eventId)).toEqual([3, 4]);
    expect(harness.reads[1]?.cursor).toBe('cursor-2');
    expect(harness.reads[2]?.cursor).toBe('cursor-4');
  });
});

describe('streamConversationOperation budget', () => {
  test('each long poll receives only the remaining budget', async () => {
    const harness = streamHarness([
      delayThenPage(60, runningPage([acceptedEvent()], 4)),
      delayThenPage(60, runningPage([deltaEvent(2, 'a')], 4)),
      delayThenPage(500, runningPage([deltaEvent(3, 'b')], 4)),
    ]);

    const error = await errorOf(async () => {
      for await (const event of harness.client.streamConversationOperation(OPERATION_ID, {
        timeoutMs: 150,
      })) {
        void event;
      }
    });

    expect(isCaveClientError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('timeout');
    expect((error as { operationId?: string }).operationId).toBe(OPERATION_ID);
    // The stream died on budget exhaustion: three polls were attempted and
    // the third was cut off by the shared deadline.
    expect(harness.reads).toHaveLength(3);
    expect(harness.reads[2]?.deadline).toBeDefined();
  });
});

describe('streamConversationOperation route errors', () => {
  test('surfaces reconcile_required from the route as an instruction to reload', async () => {
    const harness = streamHarness([
      () =>
        Promise.resolve(
          envelopeError('reconcile_required', 'Replay history is unavailable.', {
            reason: 'replay_gap',
          }),
        ),
    ]);

    const error = await errorOf(async () => {
      for await (const event of harness.client.streamConversationOperation(OPERATION_ID)) {
        expect(event).toBeDefined();
      }
    });

    expect(isCaveClientError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('reconcile_required');
    expect((error as { operationId?: string }).operationId).toBe(OPERATION_ID);
    expect(caveConversationReconcileReason(error)).toBe('replay_gap');
  });
});
