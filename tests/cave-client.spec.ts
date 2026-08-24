import {
  CaveClient,
  isCaveClientError,
  type CaveConversation,
  type CaveConversationDetail,
  type CaveMessage,
} from '@opencoven/cave-client';
import type { OperationContext, OperationEvent } from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const CURSOR = 'eyJwYWdlIjoyfQ';

const CANONICAL_FAMILIAR = {
  id: 'familiar-1',
  name: 'cody',
  repository: 'OpenCoven/cody',
  displayName: 'Cody',
  description: 'Implementation familiar',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T01:00:00.000Z',
} as const;

const PROJECT = {
  id: 'project-1',
  name: 'OpenCoven Chat',
  familiarIds: ['familiar-1'],
  repository: 'OpenCoven/chat',
  defaultBranch: 'main',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T01:00:00.000Z',
} as const;

const CONVERSATION = {
  id: 'conversation-1',
  familiarId: 'familiar-1',
  projectId: 'project-1',
  title: 'Canonical reads',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T01:00:00.000Z',
} as const;

const CONVERSATION_DETAIL = {
  ...CONVERSATION,
  metadata: {
    nested: { future: true },
    tags: ['sdk', 2],
  },
  branchId: 'branch-1',
  headMessageId: 'message-2',
  state: {
    activePath: ['message-1', 'message-2'],
    currentVersion: 3,
    baseVersion: 1,
  },
} as const;

const MESSAGE = {
  id: 'message-1',
  parentId: null,
  type: 'user',
  content: 'Read canonical state.',
  createdAt: '2026-08-24T00:30:00.000Z',
  familiarId: 'familiar-1',
  metadata: {
    source: 'fixture',
    arbitrary: { retained: true },
  },
} as const;

const VALID_HEALTH_RESPONSE = {
  apiVersion: '1.0',
  capabilities: ['health'],
  minimumClientVersion: '0.1.0',
  operations: ['health.read'],
  data: {
    instanceId: 'test-cave',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
} as const;

function clientWithRead(
  read: (path: string, context?: OperationContext) => Promise<unknown>,
  operation?: ConstructorParameters<typeof CaveClient>[0]['operation'],
) {
  const health = vi.fn(() => Promise.resolve(VALID_HEALTH_RESPONSE));
  const getJson = vi.fn(read);
  const client = new CaveClient({
    transport: { health },
    readTransport: { getJson },
    ...(operation === undefined ? {} : { operation }),
  });

  return { client, getJson, health };
}

async function errorOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (isCaveClientError(error)) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected the call to reject.');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Cave caller-supplied canonical reads', () => {
  test.each([
    {
      method: 'listCanonicalFamiliars' as const,
      path: '/api/client/v1/familiars?limit=50',
      envelope: { data: { familiars: [CANONICAL_FAMILIAR] } },
      expected: CANONICAL_FAMILIAR,
    },
    {
      method: 'listProjects' as const,
      path: '/api/client/v1/projects?limit=50',
      envelope: { data: { projects: [PROJECT] } },
      expected: PROJECT,
    },
    {
      method: 'listConversations' as const,
      path: '/api/client/v1/conversations?limit=50',
      envelope: { data: { conversations: [CONVERSATION] } },
      expected: CONVERSATION,
    },
  ])('reads one $method page with the core default limit', async ({
    method,
    path,
    envelope,
    expected,
  }) => {
    const { client, getJson } = clientWithRead(() => Promise.resolve(envelope));

    const page = await client[method]();

    expect(page).toEqual({ data: [expected] });
    expect(getJson).toHaveBeenCalledOnce();
    expect(getJson.mock.calls[0]?.[0]).toBe(path);
  });

  test('includes a supplied cursor after the encoded limit', async () => {
    const { client, getJson } = clientWithRead(() =>
      Promise.resolve({
        data: { projects: [PROJECT] },
        cursor: {
          current: CURSOR,
          next: 'eyJwYWdlIjozfQ',
          previous: 'eyJwYWdlIjoxfQ',
          hasMore: true,
        },
      }),
    );

    await expect(
      client.listProjects({ limit: 25, cursor: CURSOR }),
    ).resolves.toEqual({
      data: [PROJECT],
      cursor: {
        current: CURSOR,
        next: 'eyJwYWdlIjozfQ',
        previous: 'eyJwYWdlIjoxfQ',
        hasMore: true,
      },
    });
    expect(getJson.mock.calls[0]?.[0]).toBe(
      '/api/client/v1/projects?limit=25&cursor=eyJwYWdlIjoyfQ',
    );
  });

  test('encodes a conversation id and preserves detail metadata and state', async () => {
    const { client, getJson } = clientWithRead(() =>
      Promise.resolve({
        data: {
          conversation: {
            ...CONVERSATION_DETAIL,
            futureField: 'ignored',
          },
        },
      }),
    );

    const detail = await client.getConversation('conversation/one?draft');

    expect(detail).toEqual(CONVERSATION_DETAIL);
    expect(detail.metadata).toEqual(CONVERSATION_DETAIL.metadata);
    expect(getJson.mock.calls[0]?.[0]).toBe(
      '/api/client/v1/conversations/conversation%2Fone%3Fdraft',
    );
  });

  test('lists encoded conversation messages and preserves nullable and optional fields', async () => {
    const messageWithoutOptionals = {
      id: 'message-2',
      parentId: 'message-1',
      type: 'assistant',
      content: 'Canonical state loaded.',
      createdAt: '2026-08-24T00:31:00.000Z',
    } as const;
    const { client, getJson } = clientWithRead(() =>
      Promise.resolve({
        data: { messages: [MESSAGE, messageWithoutOptionals] },
        cursor: { hasMore: false },
      }),
    );

    const page = await client.listMessages('conversation/one');

    expect(page).toEqual({
      data: [MESSAGE, messageWithoutOptionals],
      cursor: { hasMore: false },
    });
    expect(page.data[0]?.parentId).toBeNull();
    expect(Object.keys(page.data[1] ?? {})).toEqual([
      'id',
      'parentId',
      'type',
      'content',
      'createdAt',
    ]);
    expect(getJson.mock.calls[0]?.[0]).toBe(
      '/api/client/v1/conversations/conversation%2Fone/messages?limit=50',
    );
  });

  test('preserves absent optional conversation fields as absent', async () => {
    const minimalConversation: CaveConversation = {
      id: 'conversation-2',
      familiarId: 'familiar-1',
      updatedAt: '2026-08-24T02:00:00.000Z',
    };
    const { client } = clientWithRead(() =>
      Promise.resolve({
        data: { conversations: [minimalConversation] },
      }),
    );

    const page = await client.listConversations();

    expect(page.data[0]).toEqual(minimalConversation);
    expect(Object.keys(page.data[0] ?? {})).toEqual([
      'id',
      'familiarId',
      'updatedAt',
    ]);
  });

  test.each([
    ['data.projects', { data: { projects: 'not-an-array' } }],
    [
      'data.projects[0].repository',
      { data: { projects: [{ ...PROJECT, repository: 42 }] } },
    ],
    [
      'cursor.next',
      {
        data: { projects: [] },
        cursor: { next: 'conversation-list:cursor:1', hasMore: true },
      },
    ],
  ])('rejects malformed success field %s with a stable path', async (
    field,
    response,
  ) => {
    const { client } = clientWithRead(() => Promise.resolve(response));

    const error = await errorOf(() => client.listProjects());

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation: 'listProjects',
      retryable: false,
    });
    expect(error.details).toEqual({ field });
  });

  test('requires message parentId even though its value may be null', async () => {
    const withoutParentId: Record<string, unknown> = { ...MESSAGE };
    delete withoutParentId.parentId;
    const { client } = clientWithRead(() =>
      Promise.resolve({ data: { messages: [withoutParentId] } }),
    );

    const error = await errorOf(() => client.listMessages('conversation-1'));

    expect(error.details).toEqual({ field: 'data.messages[0].parentId' });
  });

  test('rejects an empty route id as invalid_options before transport I/O', async () => {
    const { client, getJson } = clientWithRead(() =>
      Promise.resolve({ data: { conversation: CONVERSATION_DETAIL } }),
    );

    await expect(client.getConversation('   ')).rejects.toMatchObject({
      code: 'invalid_options',
      retryable: false,
    });
    await expect(client.listMessages('')).rejects.toMatchObject({
      code: 'invalid_options',
      retryable: false,
    });
    expect(getJson).not.toHaveBeenCalled();
  });

  test('uses shared core page validation before transport I/O', async () => {
    const { client, getJson } = clientWithRead(() =>
      Promise.resolve({ data: { projects: [] } }),
    );

    await expect(client.listProjects({ limit: 0 })).rejects.toMatchObject({
      code: 'invalid_options',
    });
    await expect(
      client.listProjects({ cursor: 'not canonical' }),
    ).rejects.toMatchObject({
      code: 'invalid_options',
    });
    expect(getJson).not.toHaveBeenCalled();
  });

  test('passes the composed operation context and observes one client lifecycle', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    let receivedContext: OperationContext | undefined;
    const { client, getJson } = clientWithRead(
      (_path, context) => {
        receivedContext = context;
        return Promise.resolve({ data: { projects: [] } });
      },
      {
        timeoutMs: 100,
        observer: {
          onEvent(event) {
            events.push(event);
          },
          onObserverError(error) {
            throw error;
          },
        },
      },
    );

    await client.listProjects();

    expect(receivedContext?.signal).toBeInstanceOf(AbortSignal);
    expect(receivedContext?.deadline).toBe(performance.now() + 100);
    expect(Object.keys(getJson.mock.calls[0]?.[1] ?? {}).sort()).toEqual([
      'deadline',
      'signal',
    ]);
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'success']);
    expect(events.map(({ operation }) => operation)).toEqual([
      'listProjects',
      'listProjects',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('times out a non-cooperative read transport without retrying', async () => {
    vi.useFakeTimers();
    let context: OperationContext | undefined;
    const { client, getJson } = clientWithRead((_path, receivedContext) => {
      context = receivedContext;
      return new Promise<never>(() => undefined);
    });
    const result = client.listCanonicalFamiliars({ timeoutMs: 10 });
    const caught = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(context?.signal.aborted).toBe(true);
    await expect(caught).resolves.toMatchObject({
      normalized: {
        code: 'timeout',
        operation: 'listCanonicalFamiliars',
        retryable: true,
      },
    });
    expect(getJson).toHaveBeenCalledOnce();
  });

  test('threads caller abort through the read transport', async () => {
    const controller = new AbortController();
    let context: OperationContext | undefined;
    const { client, getJson } = clientWithRead((_path, receivedContext) => {
      context = receivedContext;
      return new Promise<never>(() => undefined);
    });
    const result = client.listMessages('conversation-1', {
      signal: controller.signal,
    });
    const caught = result.catch((error: unknown) => error);

    controller.abort('caller stopped');

    expect(context?.signal.aborted).toBe(true);
    await expect(caught).resolves.toMatchObject({
      normalized: {
        code: 'aborted',
        operation: 'listMessages',
        retryable: false,
      },
    });
    expect(getJson).toHaveBeenCalledOnce();
  });

  test('normalizes a read transport failure without health, discovery, bearer, or retry side effects', async () => {
    const transportFailure = Object.assign(new Error('offline'), {
      code: 'service_unavailable',
      retryable: true,
    });
    const { client, getJson, health } = clientWithRead(() =>
      Promise.reject(transportFailure),
    );

    const error = await errorOf(() => client.listConversations());

    expect(error.normalized).toMatchObject({
      code: 'service_unavailable',
      operation: 'listConversations',
      retryable: true,
    });
    expect(error.cause).toBe(transportFailure);
    expect(getJson).toHaveBeenCalledOnce();
    expect(health).not.toHaveBeenCalled();
  });

  test('reports canonical reads as unsupported when no read transport is supplied', async () => {
    const client = new CaveClient({
      transport: {
        health: () => Promise.resolve(VALID_HEALTH_RESPONSE),
      },
    });

    await expect(client.listProjects()).rejects.toMatchObject({
      normalized: {
        code: 'unsupported_operation',
        operation: 'listProjects',
      },
    });
  });
});

function canonicalCompileOnly(
  conversation: CaveConversation,
  detail: CaveConversationDetail,
  message: CaveMessage,
): void {
  void conversation;
  void detail;
  void message;
}

void canonicalCompileOnly;
