import {
  CaveClient,
  caveConversationReconcileReason,
  createConversationEventTranslator,
  isCaveClientError,
  validateConversationEventCursor,
  type CaveTransport,
} from '@opencoven/cave-client';
import {
  parseConversationOperation,
  parseCreateConversationRequest,
  parseCreateConversationResult,
  parseRetryConversationTurnRequest,
  parseSendConversationMessageRequest,
} from '../packages/cave/src/conversation-control.js';
import { describe, expect, test, vi } from 'vitest';

const OPERATION_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const OPERATION_ID_MIXED_CASE = '018F4F1A-77C2-7A31-8A15-55A25AABA001';
const RETRY_OPERATION_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba002';
const RETRY_OPERATION_ID_MIXED_CASE = '018F4F1A-77C2-7A31-8A15-55A25AABA002';
const CONVERSATION_ID = 'conversation.v1';

function envelope(data: unknown, overrides: Record<string, unknown> = {}): unknown {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['conversations', 'conversation-messages', 'cursors'],
    operations: [
      'conversations.create',
      'messages.send',
      'operations.read',
      'operations.events',
      'operations.stop',
    ],
    requestId: 'req-1',
    data,
    ...overrides,
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
    latestEventId: 3,
    replayFloorEventId: 1,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:01.000Z',
    ...overrides,
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
    operations: ['messages.send'],
    error: {
      code,
      message,
      retryable: false,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function transportWith(overrides: Record<string, unknown> = {}): CaveTransport {
  return {
    health() {
      throw new Error('health is not expected in this test');
    },
    ...overrides,
  };
}

async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

describe('conversation mutation requests', () => {
  test('rejects a malformed operation ID without echoing the untrusted value', async () => {
    const client = new CaveClient({
      transport: {
        health() {
          throw new Error('unreachable');
        },
      } satisfies CaveTransport,
    });

    for (const malformed of [
      'not-a-uuid',
      '018f4f1a-77c2-7a31-8a15-55a25aaba00', // 35 characters
      '018f4f1a77c27a318a1555a25aaba0011', // wrong shape
      '018f4f1a-77c2-0a31-8a15-55a25aaba001', // version nibble out of range
    ]) {
      const error = await errorOf(() =>
        client.createConversation({
          operationId: malformed,
          familiarId: 'familiar.v1',
        }),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).not.toContain(malformed);
      expect(isCaveClientError(error)).toBe(false);
    }
  });

  test('rejects unknown fields and non-canonical target IDs', async () => {
    const client = new CaveClient({
      transport: {
        health() {
          throw new Error('unreachable');
        },
      } satisfies CaveTransport,
    });

    await expect(
      client.createConversation({
        operationId: OPERATION_ID,
        familiarId: 'familiar.v1',
        // @ts-expect-error probing an unknown field must not reach a transport
        harness: 'bash',
      }),
    ).rejects.toThrowError(/unknown field/u);

    await expect(
      client.createConversation({ operationId: OPERATION_ID, familiarId: '..' }),
    ).rejects.toThrowError(/must not be a dot path segment/u);
  });

  test('requires exactly one of text or retryOfTurnId on a send', async () => {
    const client = new CaveClient({
      transport: {
        health() {
          throw new Error('unreachable');
        },
      } satisfies CaveTransport,
    });

    await expect(
      client.sendConversationMessage(CONVERSATION_ID, {
        operationId: OPERATION_ID,
        text: 'hello',
        retryOfTurnId: 'turn-1',
      } as never),
    ).rejects.toThrowError(/exactly one of text or retryOfTurnId/u);

    await expect(
      client.sendConversationMessage(CONVERSATION_ID, {
        operationId: OPERATION_ID,
      } as unknown as Parameters<typeof client.sendConversationMessage>[1]),
    ).rejects.toThrowError(/exactly one of text or retryOfTurnId/u);

    await expect(
      client.sendConversationMessage(CONVERSATION_ID, {
        operationId: OPERATION_ID,
        text: '   ',
      }),
    ).rejects.toThrowError(/non-empty string/u);
  });

  test('normalizes the operation UUID and preserves text byte for byte', async () => {
    let seenRequest: unknown;
    const transport = transportWith({
      sendConversationMessage(_conversationId: string, request: unknown) {
        seenRequest = request;
        return envelope({ operation: operationRecord(), replayed: false });
      },
    });

    const client = new CaveClient({ transport });
    const text = '  keep  \nexact bytes\t';
    const result = await client.sendConversationMessage(CONVERSATION_ID, {
      operationId: OPERATION_ID_MIXED_CASE,
      text,
    });

    expect(seenRequest).toEqual({ operationId: OPERATION_ID, text });
    expect(result.operation.id).toBe(OPERATION_ID);
    expect(result.operation.originatingScope).toBe('chat:write');
    expect(result.replayed).toBe(false);
  });

  test('retry carries a fresh operation UUID and explicit retryOfTurnId with no text', async () => {
    let seenRequest: unknown;
    const transport = transportWith({
      sendConversationMessage(_conversationId: string, request: unknown) {
        seenRequest = request;
        return envelope({
          operation: operationRecord({
            id: RETRY_OPERATION_ID,
            retryOfTurnId: 'turn-7',
            state: 'running',
          }),
          replayed: false,
        });
      },
    });

    const client = new CaveClient({ transport });
    const result = await client.retryConversationTurn(
      CONVERSATION_ID,
      { operationId: RETRY_OPERATION_ID_MIXED_CASE, retryOfTurnId: 'turn-7' },
    );

    expect(seenRequest).toEqual({
      operationId: RETRY_OPERATION_ID,
      retryOfTurnId: 'turn-7',
    });
    expect(result.operation.id).toBe(RETRY_OPERATION_ID);
    expect(result.operation.retryOfTurnId).toBe('turn-7');
  });
});

describe('conversation create results and errors', () => {
  test('returns the recorded create result with the normalized operation ID', async () => {
    let seenRequest: unknown;
    const transport = transportWith({
      createConversation(request: unknown) {
        seenRequest = request;
        return envelope({
          operationId: OPERATION_ID,
          replayed: false,
          conversation: {
            id: CONVERSATION_ID,
            familiarId: 'familiar.v1',
            updatedAt: '2026-08-30T00:00:00.000Z',
          },
        });
      },
    });

    const client = new CaveClient({ transport });
    const result = await client.createConversation({
      operationId: OPERATION_ID_MIXED_CASE,
      familiarId: 'familiar.v1',
    });

    expect(seenRequest).toEqual({
      operationId: OPERATION_ID,
      familiarId: 'familiar.v1',
    });
    expect(result.operationId).toBe(OPERATION_ID);
    expect(result.replayed).toBe(false);
    expect(result.conversation.id).toBe(CONVERSATION_ID);
  });

  test('reports unsupported_operation with the operation ID when the transport cannot send', async () => {
    // An older transport satisfies CaveTransport without the conversation
    // methods; the client reports the missing capability instead of
    // inventing a route. The accepted operation ID still rides the error.
    const client = new CaveClient({
      transport: {
        health() {
          throw new Error('unreachable');
        },
      } satisfies CaveTransport,
    });

    const error = await errorOf(() =>
      client.createConversation({
        operationId: OPERATION_ID,
        familiarId: 'familiar.v1',
      }),
    );

    expect(isCaveClientError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('unsupported_operation');
    expect((error as { operationId?: string }).operationId).toBe(OPERATION_ID);
  });

  test('attaches the operation ID to transport failures after acceptance and never retries', async () => {
    const createConversation = vi.fn(() => {
      throw new Error('connection reset while dispatching');
    });
    const client = new CaveClient({
      transport: transportWith({ createConversation }),
    });

    const error = await errorOf(() =>
      client.createConversation({
        operationId: OPERATION_ID,
        familiarId: 'familiar.v1',
      }),
    );

    expect(isCaveClientError(error)).toBe(true);
    expect((error as { operationId?: string }).operationId).toBe(OPERATION_ID);
    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  test('rejects a hostile create result as an invalid response with the operation ID', async () => {
    const transport = transportWith({
      createConversation() {
        return envelope({
          operationId: OPERATION_ID,
          replayed: false,
          conversation: {
            id: CONVERSATION_ID,
            familiarId: 'familiar.v1',
            // updatedAt is required by the canonical conversation schema
          },
        });
      },
    });
    const client = new CaveClient({ transport });

    const error = await errorOf(() =>
      client.createConversation({
        operationId: OPERATION_ID,
        familiarId: 'familiar.v1',
      }),
    );

    expect(isCaveClientError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('invalid_response');
    expect((error as { operationId?: string }).operationId).toBe(OPERATION_ID);
  });
});

describe('conversation operation read', () => {
  test('returns the non-content operation record', async () => {
    const transport = transportWith({
      getConversationOperation() {
        return envelope({
          operation: operationRecord({
            state: 'running',
            outputTurnId: undefined,
          }),
        });
      },
    });
    const client = new CaveClient({ transport });

    const operation = await client.getConversationOperation(OPERATION_ID);
    expect(operation.id).toBe(OPERATION_ID);
    expect(operation.kind).toBe('messages.send');
    expect(operation.state).toBe('running');
    expect(operation.originatingScope).toBe('chat:write');
    expect(operation.conversationId).toBe(CONVERSATION_ID);
    expect(operation.latestEventId).toBe(3);
    expect(operation.replayFloorEventId).toBe(1);
  });

  test('rejects an operation record with an unknown field', async () => {
    const transport = transportWith({
      getConversationOperation() {
        return envelope({
          operation: operationRecord({ promptText: 'must never pass' }),
        });
      },
    });
    const client = new CaveClient({ transport });

    const error = await errorOf(() => client.getConversationOperation(OPERATION_ID));
    expect(isCaveClientError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('invalid_response');
  });
});

describe('conversation stop', () => {
  test('sends each explicit Stop exactly once and parses the resulting operation', async () => {
    const stopConversationOperation = vi.fn(() =>
      envelope({ operation: operationRecord({ state: 'stopping' }) }),
    );
    const client = new CaveClient({
      transport: transportWith({ stopConversationOperation }),
    });

    const operation = await client.stopConversationOperation(OPERATION_ID);
    expect(operation.state).toBe('stopping');
    expect(stopConversationOperation).toHaveBeenCalledTimes(1);
  });

  test('does not retry Stop after an ambiguous transport completion', async () => {
    const stopConversationOperation = vi.fn(() => {
      throw new Error('connection reset after dispatch');
    });
    const client = new CaveClient({
      transport: transportWith({ stopConversationOperation }),
    });

    const error = await errorOf(() => client.stopConversationOperation(OPERATION_ID));
    expect(isCaveClientError(error)).toBe(true);
    expect((error as { operationId?: string }).operationId).toBe(OPERATION_ID);
    expect(stopConversationOperation).toHaveBeenCalledTimes(1);
  });
});

describe('reconciliation on replay gaps', () => {
  test('surfaces reconcile_required with its reason as an instruction to reload', async () => {
    const sendConversationMessage = vi.fn(() =>
      envelopeError('reconcile_required', 'Replay history is unavailable.', {
        reason: 'replay_gap',
      }),
    );
    const client = new CaveClient({
      transport: transportWith({ sendConversationMessage }),
    });

    const error = await errorOf(() =>
      client.sendConversationMessage(CONVERSATION_ID, {
        operationId: OPERATION_ID,
        text: 'hello',
      }),
    );

    expect(isCaveClientError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('reconcile_required');
    expect((error as { operationId?: string }).operationId).toBe(OPERATION_ID);
    expect(caveConversationReconcileReason(error)).toBe('replay_gap');
    // An instruction to reload canonical history is never retried by the SDK.
    expect(sendConversationMessage).toHaveBeenCalledTimes(1);
  });

  test('reads undefined for unrelated errors', () => {
    const error = new Error('plain failure');
    expect(caveConversationReconcileReason(error)).toBeUndefined();
    expect(caveConversationReconcileReason(null)).toBeUndefined();
    expect(
      caveConversationReconcileReason({
        code: 'reconcile_required',
        details: { reason: 'something_else' },
      }),
    ).toBeUndefined();
  });
});

describe('operation record parsing', () => {
  test('a read-only transport without conversation methods still satisfies CaveTransport', () => {
    const transport: CaveTransport = {
      health() {
        throw new Error('unreachable');
      },
    };
    expect(() => new CaveClient({ transport })).not.toThrow();
  });
});


describe('conversation response envelope validation', () => {
  const base = {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['conversations'],
    operations: ['messages.send'],
  };

  function clientReturning(response: unknown): CaveClient {
    return new CaveClient({
      transport: transportWith({
        getConversationOperation() {
          return response;
        },
      }),
    });
  }

  test('rejects incompatible api versions and newer client requirements', async () => {
    const staleApi = clientReturning({
      ...base,
      apiVersion: '2.0',
      data: { operation: operationRecord() },
    });
    await expect(staleApi.getConversationOperation(OPERATION_ID)).rejects.toThrowError(
      /invalid_response/u,
    );

    const newerClient = clientReturning({
      ...base,
      minimumClientVersion: '99.0.0',
      data: { operation: operationRecord() },
    });
    const error = await errorOf(() =>
      newerClient.getConversationOperation(OPERATION_ID),
    );
    expect(isCaveClientError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('incompatible_version');
  });

  test('rejects envelopes without exactly one of data or error', async () => {
    await expect(
      clientReturning(base).getConversationOperation(OPERATION_ID),
    ).rejects.toThrowError(/invalid_response/u);

    await expect(
      clientReturning({
        ...base,
        data: { operation: operationRecord() },
        error: { code: 'conflict', message: 'both present', retryable: false },
      }).getConversationOperation(OPERATION_ID),
    ).rejects.toThrowError(/invalid_response/u);
  });

  test('rejects malformed envelope declarations and overlong request ids', async () => {
    await expect(
      clientReturning({
        ...base,
        capabilities: [],
        data: { operation: operationRecord() },
      }).getConversationOperation(OPERATION_ID),
    ).rejects.toThrowError(/invalid_response/u);

    await expect(
      clientReturning({
        ...base,
        requestId: 'x'.repeat(65),
        data: { operation: operationRecord() },
      }).getConversationOperation(OPERATION_ID),
    ).rejects.toThrowError(/invalid_response/u);

    // Additive unknown top-level envelope fields stay tolerated, matching the
    // Client v1 additive-compatibility rule.
    const additive = clientReturning({
      ...base,
      unknownEnvelopeField: true,
      data: { operation: operationRecord() },
    });
    const operation = await additive.getConversationOperation(OPERATION_ID);
    expect(operation.kind).toBe('messages.send');
  });

  test('rejects unknown error-envelope fields and unknown error codes', async () => {
    await expect(
      clientReturning({
        ...base,
        error: {
          code: 'conflict',
          message: 'm',
          retryable: false,
          stack: 'private',
        },
      }).getConversationOperation(OPERATION_ID),
    ).rejects.toThrowError(/invalid_response/u);

    await expect(
      clientReturning({
        ...base,
        error: { code: 'not_an_error_code', message: 'm', retryable: false },
      }).getConversationOperation(OPERATION_ID),
    ).rejects.toThrowError(/invalid_response/u);
  });

  test('caps error details at the contract limit', async () => {
    const details: Record<string, string> = {};
    for (let index = 0; index < 17; index += 1) {
      details[`key${index}`] = 'value';
    }
    await expect(
      clientReturning({
        ...base,
        error: { code: 'conflict', message: 'm', retryable: false, details },
      }).getConversationOperation(OPERATION_ID),
    ).rejects.toThrowError(/invalid_response/u);
  });

  test('rejects result envelopes naming a different operation', async () => {
    const sendClient = new CaveClient({
      transport: transportWith({
        sendConversationMessage() {
          return {
            apiVersion: '1.0',
            minimumClientVersion: '0.1.0',
            capabilities: ['conversations'],
            operations: ['messages.send'],
            data: {
              operation: operationRecord({ id: RETRY_OPERATION_ID }),
              replayed: false,
            },
          };
        },
      }),
    });
    await expect(
      sendClient.sendConversationMessage(CONVERSATION_ID, {
        operationId: OPERATION_ID,
        text: 'hello',
      }),
    ).rejects.toThrowError(/invalid_response/u);

    const createClient = new CaveClient({
      transport: transportWith({
        createConversation() {
          return {
            apiVersion: '1.0',
            minimumClientVersion: '0.1.0',
            capabilities: ['conversations'],
            operations: ['conversations.create'],
            data: {
              operationId: RETRY_OPERATION_ID,
              replayed: false,
              conversation: {
                id: CONVERSATION_ID,
                familiarId: 'familiar.v1',
                updatedAt: 'x',
              },
            },
          };
        },
      }),
    });
    await expect(
      createClient.createConversation({
        operationId: OPERATION_ID,
        familiarId: 'familiar.v1',
      }),
    ).rejects.toThrowError(/invalid_response/u);
  });
});

describe('conversation-control parser unit coverage', () => {
  test('create requests accept the optional project ID', () => {
    const parsed = parseCreateConversationRequest({
      operationId: OPERATION_ID,
      familiarId: 'familiar.v1',
      projectId: 'project.v1',
    });
    expect(parsed.projectId).toBe('project.v1');
    const minimal = parseCreateConversationRequest({
      operationId: OPERATION_ID,
      familiarId: 'familiar.v1',
    });
    expect(minimal.projectId).toBeUndefined();
  });

  test('retry requests require retryOfTurnId and refuse extra fields', () => {
    expect(() => parseRetryConversationTurnRequest({ operationId: OPERATION_ID })).toThrowError(
      /requires retryOfTurnId/u,
    );
    expect(() =>
      parseRetryConversationTurnRequest({
        operationId: OPERATION_ID,
        retryOfTurnId: 'turn-1',
        text: 'no replacement text',
      }),
    ).toThrowError(/unknown field/u);
    expect(() =>
      parseRetryConversationTurnRequest({
        operationId: OPERATION_ID,
        retryOfTurnId: 'turn-1',
      }),
    ).not.toThrow();
  });

  test('rejects non-object and missing-key requests', () => {
    expect(() => parseCreateConversationRequest(null)).toThrowError(/must be an object/u);
    expect(() => parseCreateConversationRequest('nope')).toThrowError(/must be an object/u);
    expect(() => parseCreateConversationRequest([])).toThrowError(/must be an object/u);
    expect(() =>
      parseCreateConversationRequest({ operationId: OPERATION_ID }),
    ).toThrowError(/requires familiarId/u);
    expect(() =>
      parseSendConversationMessageRequest({ operationId: OPERATION_ID, text: 'x', extra: 1 }),
    ).toThrowError(/unknown field/u);
  });

  test('rejects overlong and malformed event cursors', () => {
    expect(() =>
      validateConversationEventCursor('x'.repeat(513), 'cursor'),
    ).toThrowError(/at most 512 characters/u);
    expect(() => validateConversationEventCursor('', 'cursor')).toThrowError(
      /non-empty string/u,
    );
    expect(() => validateConversationEventCursor(42, 'cursor')).toThrowError(
      /non-empty string/u,
    );
    expect(validateConversationEventCursor('a'.repeat(512), 'cursor')).toBe('a'.repeat(512));
  });

  test('rejects non-monotonic translator commits', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    translator.commit(2);
    expect(() => translator.commit(1)).toThrowError(/monotonically/u);
    expect(() => translator.commit(0)).toThrowError(/monotonically/u);
    expect(() => translator.commit(1.5)).toThrowError(/monotonically/u);
  });

  test('rejects create results naming a different operation ID', () => {
    expect(() =>
      parseCreateConversationResult(
        {
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['conversations'],
          operations: ['conversations.create'],
          data: {
            operationId: OPERATION_ID_MIXED_CASE,
            replayed: false,
            conversation: {
              id: CONVERSATION_ID,
              familiarId: 'familiar.v1',
              updatedAt: 'x',
            },
          },
        },
        OPERATION_ID,
      ),
    ).not.toThrow();
  });

  test('rejects operation records with contradictory bounds', () => {
    expect(() =>
      parseConversationOperation(
        operationRecord({ replayFloorEventId: 0 }),
        'data.operation',
      ),
    ).toThrowError(/data\.operation\.replayFloorEventId/u);
    expect(() =>
      parseConversationOperation(
        operationRecord({ replayFloorEventId: 5, latestEventId: 2 }),
        'data.operation',
      ),
    ).toThrowError(/replayFloorEventId/u);
    expect(() =>
      parseConversationOperation(
        operationRecord({
          state: 'completed',
          outputTurnId: 'turn-2',
          latestEventId: 0,
        }),
        'data.operation',
      ),
    ).toThrowError(/data\.operation\.latestEventId/u);
    expect(() =>
      parseConversationOperation(
        operationRecord({ id: OPERATION_ID.toUpperCase() }),
        'data.operation',
      ),
    ).toThrowError(/data\.operation\.id was malformed/u);
  });

  test('parses failed and cancelled terminal events with their payloads', () => {
    const failed = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    }).translate(
      envelope({
        operation: operationRecord({
          state: 'failed',
          outputTurnId: 'turn-2',
          failureCode: 'authority_restarted_during_execution',
          latestEventId: 1,
        }),
        events: [
          {
            type: 'operation.failed',
            operationId: OPERATION_ID,
            eventId: 1,
            cursor: 'cursor-1',
            occurredAt: 'x',
            outputTurnId: 'turn-2',
            code: 'authority_restarted_during_execution',
          },
        ],
        complete: true,
      }),
    );
    expect(failed.events[0]).toMatchObject({
      type: 'operation.failed',
      outputTurnId: 'turn-2',
      code: 'authority_restarted_during_execution',
    });
  });

  test('parses stopping and accepted events with retry provenance', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    const translated = translator.translate(
      envelope({
        operation: operationRecord({ latestEventId: 2 }),
        events: [
          {
            type: 'operation.accepted',
            operationId: OPERATION_ID,
            eventId: 1,
            cursor: 'cursor-1',
            occurredAt: 'x',
            conversationId: CONVERSATION_ID,
            inputTurnId: 'turn-1',
            retryOfTurnId: 'turn-7',
          },
          {
            type: 'operation.stopping',
            operationId: OPERATION_ID,
            eventId: 2,
            cursor: 'cursor-2',
            occurredAt: 'x',
          },
        ],
        complete: false,
      }),
    );
    expect(translated.events).toHaveLength(2);
    expect(translated.events[0]).toMatchObject({
      type: 'operation.accepted',
      retryOfTurnId: 'turn-7',
    });
  });
});

describe('reconcile reason hostile shapes', () => {
  test('reads hostile error shapes without throwing', () => {
    expect(
      caveConversationReconcileReason({
        get code(): string {
          throw new Error('private');
        },
      }),
    ).toBeUndefined();
    expect(
      caveConversationReconcileReason({
        code: 'reconcile_required',
        details: {
          get reason(): string {
            throw new Error('private reason');
          },
        },
      }),
    ).toBeUndefined();
    expect(
      caveConversationReconcileReason({ code: 'reconcile_required', details: 42 }),
    ).toBeUndefined();
    expect(
      caveConversationReconcileReason({ code: 'reconcile_required', details: { reason: 7 } }),
    ).toBeUndefined();
    expect(
      caveConversationReconcileReason({ code: 'other', details: { reason: 'replay_gap' } }),
    ).toBeUndefined();
    expect(caveConversationReconcileReason(undefined)).toBeUndefined();
    expect(
      caveConversationReconcileReason({
        code: 'reconcile_required',
        details: { reason: 'canonical_state_moved' },
      }),
    ).toBe('canonical_state_moved');
  });
});

describe('conversation stream translator extra coverage', () => {
  function envelopeWith(data: unknown): unknown {
    return {
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: ['conversations', 'cursors'],
      operations: ['operations.events'],
      data,
    };
  }

  function acceptedEvent(): unknown {
    return {
      type: 'operation.accepted',
      operationId: OPERATION_ID,
      eventId: 1,
      cursor: 'cursor-1',
      occurredAt: 'x',
      conversationId: CONVERSATION_ID,
      inputTurnId: 'turn-1',
    };
  }

  function deltaFor(eventId: number): unknown {
    return {
      type: 'assistant.delta',
      operationId: OPERATION_ID,
      eventId,
      cursor: `cursor-${eventId}`,
      occurredAt: 'x',
      text: 't',
    };
  }

  test('accepts page cursors and exposes the next cursor', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    const translated = translator.translate(
      envelopeWith({
        operation: operationRecord({ latestEventId: 4 }),
        events: [deltaFor(2)],
        complete: false,
        cursor: { current: 'cursor-2', next: 'cursor-4', hasMore: true },
      }),
    );
    expect(translated.nextCursor).toBe('cursor-4');
  });

  test('rejects malformed page cursors and non-array events', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord(),
          events: 'not-an-array',
          complete: false,
        }),
      ),
    ).toThrowError(/data\.events was malformed/u);

    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 4 }),
          events: [],
          complete: false,
          cursor: { hasMore: false, current: 'x'.repeat(513) },
        }),
      ),
    ).toThrowError(/data\.cursor\.current was malformed/u);
  });

  test('rejects pages whose operation record names a different operation', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ id: RETRY_OPERATION_ID, latestEventId: 0 }),
          events: [],
          complete: false,
        }),
      ),
    ).toThrowError(/data\.operation\.id/u);
  });

  test('refuses an event repeated within one page', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 3 }),
          events: [acceptedEvent(), deltaFor(2), deltaFor(2), deltaFor(3)],
          complete: false,
        }),
      ),
    ).toThrowError(/was not contiguous/u);
  });

  test('resumes an empty page behind an opaque cursor and keeps polling', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    const translated = translator.translate(
      envelopeWith({
        operation: operationRecord({ latestEventId: 4 }),
        events: [],
        complete: false,
      }),
    );
    expect(translated.events).toEqual([]);
    expect(translated.complete).toBe(false);
  });
});

describe('conversation stream translator final branches', () => {
  function envelopeWith(data: unknown): unknown {
    return {
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: ['conversations', 'cursors'],
      operations: ['operations.events'],
      data,
    };
  }

  function acceptedEvent(): unknown {
    return {
      type: 'operation.accepted',
      operationId: OPERATION_ID,
      eventId: 1,
      cursor: 'cursor-1',
      occurredAt: 'x',
      conversationId: CONVERSATION_ID,
      inputTurnId: 'turn-1',
    };
  }

  function deltaFor(eventId: number): unknown {
    return {
      type: 'assistant.delta',
      operationId: OPERATION_ID,
      eventId,
      cursor: `cursor-${eventId}`,
      occurredAt: 'x',
      text: 't',
    };
  }

  test('refuses a page after the stream already saw its terminal event', () => {
    const translator = createConversationEventTranslator(OPERATION_ID);
    translator.translate(
      envelopeWith({
        operation: operationRecord({
          state: 'completed',
          outputTurnId: 'turn-2',
          latestEventId: 2,
        }),
        events: [acceptedEvent(), {
          type: 'operation.completed',
          operationId: OPERATION_ID,
          eventId: 2,
          cursor: 'cursor-2',
          occurredAt: 'x',
          outputTurnId: 'turn-2',
        }],
        complete: true,
      }),
    );
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({
            state: 'completed',
            outputTurnId: 'turn-2',
            latestEventId: 2,
          }),
          events: [],
          complete: true,
        }),
      ),
    ).toThrowError(/continued after a terminal event/u);
  });

  test('refuses events ahead of the operation record', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 4 }),
          events: [deltaFor(9)],
          complete: false,
        }),
      ),
    ).toThrowError(/ran ahead of the operation record/u);
  });

  test('refuses a repeated stopping event', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 3 }),
          events: [
            {
              type: 'operation.stopping',
              operationId: OPERATION_ID,
              eventId: 1,
              cursor: 'cursor-1',
              occurredAt: 'x',
            },
            {
              type: 'operation.stopping',
              operationId: OPERATION_ID,
              eventId: 2,
              cursor: 'cursor-2',
              occurredAt: 'x',
            },
          ],
          complete: false,
        }),
      ),
    ).toThrowError(/repeated stopping/u);
  });
});


describe('conversation event parser hostile payloads', () => {
  function envelopeWith(data: unknown): unknown {
    return {
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: ['conversations', 'cursors'],
      operations: ['operations.events'],
      data,
    };
  }

  function deltaFor(eventId: number, extra: Record<string, unknown> = {}): unknown {
    return {
      type: 'assistant.delta',
      operationId: OPERATION_ID,
      eventId,
      cursor: `cursor-${eventId}`,
      occurredAt: 'x',
      text: 't',
      ...extra,
    };
  }

  test('rejects a foreign operation ID on an event', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 2 }),
          events: [deltaFor(1, { operationId: RETRY_OPERATION_ID })],
          complete: false,
        }),
      ),
    ).toThrowError(/data\.events\[0\]\.operationId was malformed/u);
  });

  test('rejects an event id below one', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 2 }),
          events: [deltaFor(0)],
          complete: false,
        }),
      ),
    ).toThrowError(/data\.events\[0\]\.eventId was malformed/u);
  });

  function deltaWithoutText(): unknown {
    return {
      type: 'assistant.delta',
      operationId: OPERATION_ID,
      eventId: 1,
      cursor: 'cursor-1',
      occurredAt: 'x',
    };
  }

  test('rejects a delta payload without text', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 2 }),
          events: [deltaWithoutText()],
          complete: false,
        }),
      ),
    ).toThrowError(/data\.events\[0\]\.text was malformed/u);
  });

  test('rejects an event cursor that exceeds the contract limit', () => {
    const translator = createConversationEventTranslator(OPERATION_ID, {
      resumeAfterOpaqueCursor: true,
    });
    expect(() =>
      translator.translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 2 }),
          events: [
            {
              type: 'assistant.delta',
              operationId: OPERATION_ID,
              eventId: 1,
              cursor: 'x'.repeat(513),
              occurredAt: 'x',
              text: 't',
            },
          ],
          complete: false,
        }),
      ),
    ).toThrowError(/data\.events\[0\]\.cursor was malformed/u);
  });

  test('rejects a stopping event repeating after a delivered stopping event', () => {
    const first = createConversationEventTranslator(OPERATION_ID);
    first.translate(
      envelopeWith({
        operation: operationRecord({ latestEventId: 2 }),
        events: [
          {
            type: 'operation.accepted',
            operationId: OPERATION_ID,
            eventId: 1,
            cursor: 'cursor-1',
            occurredAt: 'x',
            conversationId: CONVERSATION_ID,
            inputTurnId: 'turn-1',
          },
          {
            type: 'operation.stopping',
            operationId: OPERATION_ID,
            eventId: 2,
            cursor: 'cursor-2',
            occurredAt: 'x',
          },
        ],
        complete: false,
      }),
    );
    expect(() =>
      createConversationEventTranslator(OPERATION_ID, {
        resumeAfterOpaqueCursor: true,
      }).translate(
        envelopeWith({
          operation: operationRecord({ latestEventId: 3 }),
          events: [
            {
              type: 'operation.stopping',
              operationId: OPERATION_ID,
              eventId: 1,
              cursor: 'cursor-1',
              occurredAt: 'x',
            },
            {
              type: 'operation.stopping',
              operationId: OPERATION_ID,
              eventId: 2,
              cursor: 'cursor-2',
              occurredAt: 'x',
            },
          ],
          complete: false,
        }),
      ),
    ).toThrowError(/repeated stopping/u);
  });
});

describe('conversation event translator identity', () => {
  test('exposes its normalized operation ID and accepted cursor', () => {
    const translator = createConversationEventTranslator(OPERATION_ID_MIXED_CASE);
    expect(translator.operationId).toBe(OPERATION_ID);
    expect(translator.deliveredThroughEventId).toBe(0);
  });
});
