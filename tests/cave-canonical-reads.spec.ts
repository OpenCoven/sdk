import {
  CaveClient,
  isCaveClientError,
  type CaveConversation,
  type CaveConversationMessage,
  type CaveCredentialPersistingTransport,
  type CaveTransport,
} from '@opencoven/cave-client';
import {
  createMemorySecretStore,
  createSecretStoreReference,
  type OperationContext,
  type OperationEvent,
  type PageOptions,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  canonicalConversationMessagesRoute,
  canonicalConversationRoute,
  canonicalConversationsRoute,
  canonicalFamiliarsRoute,
  canonicalProjectsRoute,
} from '../packages/cave/src/canonical-reads.js';

const CURSOR = 'eyJwYWdlIjoyfQ';
const NEXT_CURSOR = 'eyJwYWdlIjozfQ';
const CANONICAL_OPERATIONS = [
  'familiars.list',
  'projects.list',
  'conversations.list',
  'conversations.read',
  'messages.list',
] as const;

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

const FAMILIAR = {
  id: 'familiar-1',
  displayName: 'Cody',
  role: 'implementation',
  description: 'Implementation familiar',
  pronouns: 'they/them',
  status: 'active',
  lastSeenAt: '2026-08-24T01:00:00.000Z',
  activeSessions: 2,
} as const;

const PROJECT = {
  id: 'project-1',
  name: 'OpenCoven Chat',
  root: '/workspace/chat',
  color: '#7c3aed',
  repoUrl: 'https://github.com/OpenCoven/chat',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T01:00:00.000Z',
} as const;

const CONVERSATION = {
  id: 'conversation-1',
  familiarId: 'familiar-1',
  harness: 'copilot',
  model: 'gpt-5',
  runtime: 'cli',
  title: 'Canonical reads',
  origin: 'chat',
  status: 'complete',
  exitCode: 0,
  pending: false,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T01:00:00.000Z',
} as const;

const MESSAGE = {
  id: 'message-1',
  conversationId: 'conversation-1',
  parentId: null,
  role: 'user',
  text: 'Read canonical state.',
  createdAt: '2026-08-24T00:30:00.000Z',
  attachmentCount: 1,
  toolCount: 0,
  isError: false,
  cancelled: false,
} as const;

function successEnvelope(
  data: Record<string, unknown>,
  cursor?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['canonical-reads'],
    operations: CANONICAL_OPERATIONS,
    data,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function errorEnvelope(
  replacement: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['conversation-messages'],
    operations: CANONICAL_OPERATIONS,
    error: {
      code: 'reconcile_required',
      message: 'Reload canonical state.',
      retryable: false,
    },
    ...replacement,
  };
}

function clientWith(
  overrides: Partial<CaveTransport>,
  operation?: ConstructorParameters<typeof CaveClient>[0]['operation'],
) {
  const health = vi.fn(() => Promise.resolve(VALID_HEALTH_RESPONSE));
  const transport = {
    health,
    ...overrides,
  } satisfies CaveTransport;
  const client = new CaveClient({
    transport,
    ...(operation === undefined ? {} : { operation }),
  });

  return { client, health, transport };
}

async function caveErrorOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (isCaveClientError(error)) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected CaveClientError.');
}

async function collect<T>(iterator: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterator) {
    items.push(item);
  }
  return items;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Cave canonical route construction', () => {
  test('constructs only the five fixed routes with deterministic query order', () => {
    expect(canonicalFamiliarsRoute({ limit: 50 })).toBe(
      '/api/client/v1/familiars?limit=50',
    );
    expect(
      canonicalProjectsRoute({ limit: 25, cursor: CURSOR }),
    ).toBe(
      `/api/client/v1/projects?limit=25&cursor=${CURSOR}`,
    );
    expect(
      canonicalConversationsRoute({ limit: 100, cursor: NEXT_CURSOR }),
    ).toBe(
      `/api/client/v1/conversations?limit=100&cursor=${NEXT_CURSOR}`,
    );
    expect(canonicalConversationRoute('conversation/one?#')).toBe(
      '/api/client/v1/conversations/conversation%2Fone%3F%23',
    );
    expect(canonicalConversationRoute('conversation.v1')).toBe(
      '/api/client/v1/conversations/conversation.v1',
    );
    expect(
      canonicalConversationMessagesRoute('conversation/one?#', {
        limit: 1,
        cursor: CURSOR,
      }),
    ).toBe(
      `/api/client/v1/conversations/conversation%2Fone%3F%23/messages?limit=1&cursor=${CURSOR}`,
    );
  });
});

describe('Cave caller-supplied canonical reads', () => {
  test('calls all five optional transport methods with normalized options and operation context', async () => {
    const listFamiliars = vi.fn<
      (options: PageOptions, context?: OperationContext) => Promise<unknown>
    >(() =>
      Promise.resolve(successEnvelope({ familiars: [FAMILIAR] })),
    );
    const listProjects = vi.fn<
      (options: PageOptions, context?: OperationContext) => Promise<unknown>
    >(() =>
      Promise.resolve(successEnvelope({ projects: [PROJECT] })),
    );
    const listConversations = vi.fn<
      (options: PageOptions, context?: OperationContext) => Promise<unknown>
    >(() =>
      Promise.resolve(successEnvelope({ conversations: [CONVERSATION] })),
    );
    const getConversation = vi.fn<
      (
        conversationId: string,
        context?: OperationContext,
      ) => Promise<unknown>
    >(() =>
      Promise.resolve(successEnvelope({ conversation: CONVERSATION })),
    );
    const listConversationMessages = vi.fn<
      (
        conversationId: string,
        options: PageOptions,
        context?: OperationContext,
      ) => Promise<unknown>
    >(() =>
      Promise.resolve(successEnvelope({ messages: [MESSAGE] })),
    );
    const { client, health } = clientWith({
      listFamiliars,
      listProjects,
      listConversations,
      getConversation,
      listConversationMessages,
    });

    await expect(client.listFamiliars()).resolves.toEqual({
      data: [FAMILIAR],
    });
    await expect(
      client.listProjects({ limit: 25, cursor: CURSOR }),
    ).resolves.toEqual({
      data: [PROJECT],
    });
    await expect(client.listConversations()).resolves.toEqual({
      data: [CONVERSATION],
    });
    await expect(client.getConversation('conversation/one')).resolves.toEqual(
      CONVERSATION,
    );
    await expect(
      client.listConversationMessages('conversation/one', {
        limit: 100,
        cursor: CURSOR,
      }),
    ).resolves.toEqual({ data: [MESSAGE] });

    expect(listFamiliars).toHaveBeenCalledOnce();
    expect(listFamiliars.mock.calls[0]?.[0]).toEqual({ limit: 50 });
    expect(listProjects.mock.calls[0]?.[0]).toEqual({
      limit: 25,
      cursor: CURSOR,
    });
    expect(listConversations.mock.calls[0]?.[0]).toEqual({ limit: 50 });
    expect(getConversation.mock.calls[0]?.[0]).toBe('conversation/one');
    expect(listConversationMessages.mock.calls[0]?.[0]).toBe(
      'conversation/one',
    );
    expect(listConversationMessages.mock.calls[0]?.[1]).toEqual({
      limit: 100,
      cursor: CURSOR,
    });

    for (const context of [
      listFamiliars.mock.calls[0]?.[1],
      listProjects.mock.calls[0]?.[1],
      listConversations.mock.calls[0]?.[1],
      getConversation.mock.calls[0]?.[1],
      listConversationMessages.mock.calls[0]?.[2],
    ]) {
      expect(context?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(health).not.toHaveBeenCalled();
  });

  test.each([
    ['listFamiliars', (client: CaveClient) => client.listFamiliars()],
    ['listProjects', (client: CaveClient) => client.listProjects()],
    [
      'listConversations',
      (client: CaveClient) => client.listConversations(),
    ],
    [
      'getConversation',
      (client: CaveClient) => client.getConversation('conversation-1'),
    ],
    [
      'listConversationMessages',
      (client: CaveClient) =>
        client.listConversationMessages('conversation-1'),
    ],
  ])('reports missing optional %s transport as unsupported', async (
    operation,
    invoke,
  ) => {
    const { client } = clientWith({});

    await expect(invoke(client)).rejects.toMatchObject({
      normalized: {
        code: 'unsupported_operation',
        operation,
        retryable: false,
      },
    });
  });

  describe('Cave bounded canonical iteration', () => {
    test.each([
      [
        'familiars',
        (client: CaveClient) => client.iterateFamiliars({ maxPages: 1 }),
        'listFamiliars',
        'familiars',
        FAMILIAR,
      ],
      [
        'projects',
        (client: CaveClient) => client.iterateProjects({ maxPages: 1 }),
        'listProjects',
        'projects',
        PROJECT,
      ],
      [
        'conversations',
        (client: CaveClient) => client.iterateConversations({ maxPages: 1 }),
        'listConversations',
        'conversations',
        CONVERSATION,
      ],
      [
        'conversation messages',
        (client: CaveClient) =>
          client.iterateConversationMessages('conversation/one', {
            maxPages: 1,
          }),
        'listConversationMessages',
        'messages',
        MESSAGE,
      ],
    ] as const)(
      'iterates exactly one %s page through its one-page transport',
      async (_label, iterate, transportMethod, dataKey, item) => {
        const method = vi.fn(() =>
          Promise.resolve(
            successEnvelope(
              { [dataKey]: [item] },
              { hasMore: false },
            ),
          ),
        );
        const { client } = clientWith({ [transportMethod]: method });

        await expect(
          collect(iterate(client) as AsyncIterable<unknown>),
        ).resolves.toEqual([item]);
        expect(method).toHaveBeenCalledOnce();
      },
    );

    test('returns no items for an empty terminal page', async () => {
      const listProjects = vi.fn(() =>
        Promise.resolve(
          successEnvelope({ projects: [] }, { hasMore: false }),
        ),
      );
      const { client } = clientWith({ listProjects });

      await expect(
        collect(client.iterateProjects({ maxPages: 1 })),
      ).resolves.toEqual([]);
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('fetches multiple pages one at a time and preserves the initial limit and cursor', async () => {
      const listProjects = vi
        .fn()
        .mockResolvedValueOnce(
          successEnvelope(
            { projects: [{ ...PROJECT, id: 'project-2' }] },
            {
              current: CURSOR,
              next: NEXT_CURSOR,
              hasMore: true,
            },
          ),
        )
        .mockResolvedValueOnce(
          successEnvelope(
            { projects: [{ ...PROJECT, id: 'project-3' }] },
            {
              current: NEXT_CURSOR,
              hasMore: false,
            },
          ),
        );
      const { client } = clientWith({ listProjects });

      await expect(
        collect(
          client.iterateProjects({
            limit: 25,
            cursor: CURSOR,
            maxPages: 2,
          }),
        ),
      ).resolves.toMatchObject([
        { id: 'project-2' },
        { id: 'project-3' },
      ]);
      expect(listProjects).toHaveBeenCalledTimes(2);
      expect(listProjects.mock.calls[0]?.[0]).toEqual({
        limit: 25,
        cursor: CURSOR,
      });
      expect(listProjects.mock.calls[1]?.[0]).toEqual({
        limit: 25,
        cursor: NEXT_CURSOR,
      });
    });

    test('stops at maxPages before requesting page N plus one', async () => {
      const listProjects = vi
        .fn()
        .mockResolvedValueOnce(
          successEnvelope(
            { projects: [{ ...PROJECT, id: 'project-1' }] },
            { next: CURSOR, hasMore: true },
          ),
        )
        .mockResolvedValueOnce(
          successEnvelope(
            { projects: [{ ...PROJECT, id: 'project-2' }] },
            { current: CURSOR, next: NEXT_CURSOR, hasMore: true },
          ),
        )
        .mockRejectedValue(new Error('page three must not be requested'));
      const { client } = clientWith({ listProjects });

      await expect(
        collect(client.iterateProjects({ maxPages: 2 })),
      ).resolves.toMatchObject([
        { id: 'project-1' },
        { id: 'project-2' },
      ]);
      expect(listProjects).toHaveBeenCalledTimes(2);
    });

    test('supports a caller-owned signal as the only explicit bound', async () => {
      const controller = new AbortController();
      const listProjects = vi.fn(() =>
        Promise.resolve(
          successEnvelope({ projects: [PROJECT] }, { hasMore: false }),
        ),
      );
      const { client } = clientWith({ listProjects });

      await expect(
        collect(
          client.iterateProjects({ signal: controller.signal }),
        ),
      ).resolves.toEqual([PROJECT]);
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('rejects an omitted explicit bound even when TypeScript is bypassed', () => {
      const { client } = clientWith({});

      expect(() =>
        (
          client.iterateProjects as unknown as (
            options: Record<string, never>,
          ) => AsyncGenerator<unknown>
        )({}),
      ).toThrow(expect.objectContaining({ code: 'invalid_options' }));
    });

    test('is lazy and never downloads a later page without demand', async () => {
      const listProjects = vi
        .fn()
        .mockResolvedValueOnce(
          successEnvelope(
            { projects: [PROJECT] },
            { next: CURSOR, hasMore: true },
          ),
        )
        .mockRejectedValue(new Error('page two must remain lazy'));
      const { client } = clientWith({ listProjects });
      const iterator = client.iterateProjects({ maxPages: 2 });

      expect(listProjects).not.toHaveBeenCalled();
      await expect(iterator.next()).resolves.toEqual({
        value: PROJECT,
        done: false,
      });
      expect(listProjects).toHaveBeenCalledOnce();
      await expect(iterator.return(undefined)).resolves.toEqual({
        value: undefined,
        done: true,
      });
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('honors caller abort between pages without starting another request', async () => {
      const controller = new AbortController();
      const listProjects = vi.fn(() =>
        Promise.resolve(
          successEnvelope(
            { projects: [PROJECT] },
            { next: CURSOR, hasMore: true },
          ),
        ),
      );
      const { client } = clientWith({ listProjects });
      const iterator = client.iterateProjects({
        signal: controller.signal,
      });

      await expect(iterator.next()).resolves.toEqual({
        value: PROJECT,
        done: false,
      });
      controller.abort('caller stopped');

      await expect(iterator.next()).rejects.toMatchObject({
        code: 'aborted',
        retryable: false,
      });
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('honors timeout between pages without starting another request', async () => {
      vi.useFakeTimers();
      const listProjects = vi.fn(() =>
        Promise.resolve(
          successEnvelope(
            { projects: [PROJECT] },
            { next: CURSOR, hasMore: true },
          ),
        ),
      );
      const { client } = clientWith({ listProjects });
      const iterator = client.iterateProjects({
        maxPages: 2,
        timeoutMs: 10,
      });

      await expect(iterator.next()).resolves.toEqual({
        value: PROJECT,
        done: false,
      });
      await vi.advanceTimersByTimeAsync(10);

      await expect(iterator.next()).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      });
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('classifies a wrapped project transport abort in the aggregate lifecycle', async () => {
      const events: OperationEvent[] = [];
      const transportError = Object.assign(new Error('transport aborted'), {
        code: 'aborted',
        retryable: false,
        details: {
          reason: 'transport_cancelled',
        },
      });
      const listProjects = vi.fn(() => Promise.reject(transportError));
      const { client } = clientWith({ listProjects });

      const error = await caveErrorOf(() =>
        collect(
          client.iterateProjects({
            maxPages: 2,
            observer: {
              onEvent(event) {
                events.push(event);
              },
              onObserverError(observerError) {
                throw observerError;
              },
            },
          }),
        ),
      );

      expect(error.normalized).toMatchObject({
        code: 'aborted',
        operation: 'listProjects',
        retryable: false,
      });
      expect(error.details).toEqual({
        reason: 'transport_cancelled',
      });
      expect(error.cause).toBe(transportError);
      expect(events.map(({ phase }) => phase)).toEqual(['start', 'abort']);
      expect(events.map(({ operation }) => operation)).toEqual([
        'iteratePages',
        'iteratePages',
      ]);
      expect(events[1]).toMatchObject({
        phase: 'abort',
        error: {
          code: 'aborted',
          operation: 'iteratePages',
          retryable: false,
        },
      });
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('classifies a wrapped message transport timeout in the aggregate lifecycle', async () => {
      const events: OperationEvent[] = [];
      const transportError = Object.assign(new Error('transport timed out'), {
        code: 'timeout',
        retryable: true,
        details: {
          phase: 'read',
        },
      });
      const listConversationMessages = vi.fn(() =>
        Promise.reject(transportError),
      );
      const { client } = clientWith({ listConversationMessages });

      const error = await caveErrorOf(() =>
        collect(
          client.iterateConversationMessages('conversation/one', {
            maxPages: 2,
            observer: {
              onEvent(event) {
                events.push(event);
              },
              onObserverError(observerError) {
                throw observerError;
              },
            },
          }),
        ),
      );

      expect(error.normalized).toMatchObject({
        code: 'timeout',
        operation: 'listConversationMessages',
        retryable: true,
      });
      expect(error.details).toEqual({
        phase: 'read',
      });
      expect(error.cause).toBe(transportError);
      expect(events.map(({ phase }) => phase)).toEqual(['start', 'timeout']);
      expect(events.map(({ operation }) => operation)).toEqual([
        'iteratePages',
        'iteratePages',
      ]);
      expect(events[1]).toMatchObject({
        phase: 'timeout',
        error: {
          code: 'timeout',
          operation: 'iteratePages',
          retryable: true,
        },
      });
      expect(listConversationMessages).toHaveBeenCalledOnce();
    });

    test('applies the client default timeout to the aggregate iterator', async () => {
      vi.useFakeTimers();
      const listProjects = vi.fn(() =>
        Promise.resolve(
          successEnvelope(
            { projects: [PROJECT] },
            { next: CURSOR, hasMore: true },
          ),
        ),
      );
      const { client } = clientWith(
        { listProjects },
        { timeoutMs: 10 },
      );
      const iterator = client.iterateProjects({ maxPages: 2 });

      await iterator.next();
      await vi.advanceTimersByTimeAsync(10);

      await expect(iterator.next()).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      });
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test.each([
      ['missing', { current: CURSOR, hasMore: true }],
      [
        'repeated',
        { current: CURSOR, next: CURSOR, hasMore: true },
      ],
    ] as const)('rejects a %s advancing cursor without retrying', async (
      _kind,
      cursor,
    ) => {
      const listProjects = vi.fn(() =>
        Promise.resolve(
          successEnvelope({ projects: [] }, cursor),
        ),
      );
      const { client } = clientWith({ listProjects });

      await expect(
        collect(
          client.iterateProjects({ cursor: CURSOR, maxPages: 2 }),
        ),
      ).rejects.toMatchObject({
        code: 'invalid_response',
        retryable: false,
      });
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('propagates reconcile_required from messages without retrying and forwards the id', async () => {
      const events: OperationEvent[] = [];
      const listConversationMessages = vi.fn<
        (
          conversationId: string,
          options: PageOptions,
          context?: OperationContext,
        ) => Promise<unknown>
      >(() =>
        Promise.resolve(
          errorEnvelope({
            error: {
              code: 'reconcile_required',
              message: 'Reload canonical state.',
              retryable: false,
              details: {
                reason: 'resume_from_canonical_state',
              },
            },
          }),
        ),
      );
      const { client } = clientWith({ listConversationMessages });

      await expect(
        collect(
          client.iterateConversationMessages('conversation/one', {
            maxPages: 3,
            observer: {
              onEvent(event) {
                events.push(event);
              },
              onObserverError(observerError) {
                throw observerError;
              },
            },
          }),
        ),
      ).rejects.toMatchObject({
        normalized: {
          code: 'reconcile_required',
          operation: 'listConversationMessages',
          retryable: false,
        },
        details: {
          reason: 'resume_from_canonical_state',
        },
      });
      expect(listConversationMessages).toHaveBeenCalledOnce();
      expect(listConversationMessages.mock.calls[0]?.[0]).toBe(
        'conversation/one',
      );
      expect(events.map(({ phase }) => phase)).toEqual(['start', 'failure']);
      expect(events.map(({ operation }) => operation)).toEqual([
        'iteratePages',
        'iteratePages',
      ]);
    });

    test('does not retry a retryable page failure', async () => {
      const listProjects = vi.fn(() =>
        Promise.reject(
          Object.assign(new Error('offline'), {
            code: 'service_unavailable',
            retryable: true,
          }),
        ),
      );
      const { client } = clientWith({ listProjects });

      await expect(
        collect(client.iterateProjects({ maxPages: 3 })),
      ).rejects.toMatchObject({
        normalized: {
          code: 'service_unavailable',
          operation: 'listProjects',
          retryable: true,
        },
      });
      expect(listProjects).toHaveBeenCalledOnce();
    });

    test('reports exactly one aggregate observer lifecycle across multiple pages', async () => {
      const events: OperationEvent[] = [];
      const listProjects = vi
        .fn()
        .mockResolvedValueOnce(
          successEnvelope(
            { projects: [PROJECT] },
            { next: CURSOR, hasMore: true },
          ),
        )
        .mockResolvedValueOnce(
          successEnvelope({ projects: [] }, { hasMore: false }),
        );
      const { client } = clientWith(
        { listProjects },
        {
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

      await expect(
        collect(client.iterateProjects({ maxPages: 2 })),
      ).resolves.toEqual([PROJECT]);
      expect(events.map(({ phase }) => phase)).toEqual(['start', 'success']);
      expect(events.map(({ operation }) => operation)).toEqual([
        'iteratePages',
        'iteratePages',
      ]);
    });

    test('preserves Core return and throw cancellation semantics', async () => {
      const events: OperationEvent[] = [];
      const consumerError = new Error('consumer stopped');
      const listProjects = vi.fn(() =>
        Promise.resolve(
          successEnvelope(
            { projects: [PROJECT] },
            { next: CURSOR, hasMore: true },
          ),
        ),
      );
      const { client } = clientWith({ listProjects });
      const returned = client.iterateProjects({
        maxPages: 2,
        observer: {
          onEvent(event) {
            events.push(event);
          },
          onObserverError(error) {
            throw error;
          },
        },
      });

      await returned.next();
      await expect(returned.return(undefined)).resolves.toEqual({
        value: undefined,
        done: true,
      });
      expect(events.map(({ phase }) => phase)).toEqual(['start', 'abort']);

      const thrown = client.iterateProjects({ maxPages: 2 });
      await thrown.next();
      await expect(thrown.throw(consumerError)).rejects.toBe(consumerError);
      expect(listProjects).toHaveBeenCalledTimes(2);
    });

    test('preserves the first consumer throw while a page request is in flight', async () => {
      const consumerError = new Error('consumer stopped');
      const listProjects = vi.fn(
        (_options: PageOptions, context?: OperationContext) =>
          new Promise<never>((_resolve, reject) => {
            context?.signal.addEventListener(
              'abort',
              () => {
                const reason = context.signal.reason as unknown;
                reject(
                  reason instanceof Error
                    ? reason
                    : new Error('transport aborted', { cause: reason }),
                );
              },
              { once: true },
            );
          }),
      );
      const { client } = clientWith({ listProjects });
      const iterator = client.iterateProjects({ maxPages: 1 });
      const pendingNext = iterator.next().catch((error: unknown) => error);

      await vi.waitFor(() => {
        expect(listProjects).toHaveBeenCalledOnce();
      });
      const thrown = iterator.throw(consumerError).catch(
        (error: unknown) => error,
      );

      await expect(Promise.all([pendingNext, thrown])).resolves.toEqual([
        consumerError,
        consumerError,
      ]);
    });

    test.each(['', '   ', '.', '..'])(
      'validates message conversation id %j before page I/O',
      async (conversationId) => {
        const listConversationMessages = vi.fn(() =>
          Promise.resolve(successEnvelope({ messages: [] })),
        );
        const { client } = clientWith({ listConversationMessages });

        await expect(
          client
            .iterateConversationMessages(conversationId, { maxPages: 1 })
            .next(),
        ).rejects.toMatchObject({
          code: 'invalid_options',
        });
        expect(listConversationMessages).not.toHaveBeenCalled();
      },
    );
  });

  test('preserves every optional DTO field and ignores unknown additive fields', async () => {
    const { client } = clientWith({
      listFamiliars: () =>
        Promise.resolve(
          {
            ...successEnvelope({
              futureCollectionMetadata: true,
              familiars: [{ ...FAMILIAR, futureField: 'ignored' }],
            }),
            futureEnvelopeMetadata: 'ignored',
          },
        ),
      listProjects: () =>
        Promise.resolve(
          successEnvelope({
            projects: [{ ...PROJECT, futureField: 'ignored' }],
          }),
        ),
      listConversations: () =>
        Promise.resolve(
          successEnvelope({
            conversations: [{ ...CONVERSATION, futureField: 'ignored' }],
          }),
        ),
      listConversationMessages: () =>
        Promise.resolve(
          successEnvelope({
            messages: [{ ...MESSAGE, futureField: 'ignored' }],
          }),
        ),
    });

    await expect(client.listFamiliars()).resolves.toEqual({
      data: [FAMILIAR],
    });
    await expect(client.listProjects()).resolves.toEqual({
      data: [PROJECT],
    });
    await expect(client.listConversations()).resolves.toEqual({
      data: [CONVERSATION],
    });
    await expect(
      client.listConversationMessages('conversation-1'),
    ).resolves.toEqual({ data: [MESSAGE] });
  });

  test('preserves absent optional DTO fields as absent', async () => {
    const familiar = {
      id: 'familiar-2',
      displayName: 'Ada',
      role: 'review',
    };
    const project = {
      id: 'project-2',
      name: 'Cave',
      root: '/workspace/cave',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T01:00:00.000Z',
    };
    const conversation: CaveConversation = {
      id: 'conversation-2',
      familiarId: 'familiar-2',
      updatedAt: '2026-08-24T02:00:00.000Z',
    };
    const message: CaveConversationMessage = {
      id: 'message-2',
      conversationId: 'conversation-2',
      parentId: 'message-1',
      role: 'assistant',
      text: 'Done.',
      createdAt: '2026-08-24T02:01:00.000Z',
      attachmentCount: 0,
      toolCount: 1,
    };
    const { client } = clientWith({
      listFamiliars: () =>
        Promise.resolve(successEnvelope({ familiars: [familiar] })),
      listProjects: () =>
        Promise.resolve(successEnvelope({ projects: [project] })),
      listConversations: () =>
        Promise.resolve(
          successEnvelope({ conversations: [conversation] }),
        ),
      listConversationMessages: () =>
        Promise.resolve(successEnvelope({ messages: [message] })),
    });

    expect((await client.listFamiliars()).data[0]).toEqual(familiar);
    expect((await client.listProjects()).data[0]).toEqual(project);
    expect((await client.listConversations()).data[0]).toEqual(conversation);
    expect(
      (await client.listConversationMessages('conversation-2')).data[0],
    ).toEqual(message);
  });

  test('preserves a present null conversation exitCode in list and detail reads', async () => {
    const conversation = { ...CONVERSATION, exitCode: null };
    const { client } = clientWith({
      listConversations: () =>
        Promise.resolve(successEnvelope({ conversations: [conversation] })),
      getConversation: () =>
        Promise.resolve(successEnvelope({ conversation })),
    });

    await expect(client.listConversations()).resolves.toEqual({
      data: [conversation],
    });
    await expect(
      client.getConversation('conversation-1'),
    ).resolves.toEqual(conversation);
  });

  test.each([
    ['listConversations', Number.NaN],
    ['listConversations', Number.POSITIVE_INFINITY],
    ['listConversations', Number.NEGATIVE_INFINITY],
    ['listConversations', 1.5],
    ['listConversations', Number.MAX_SAFE_INTEGER + 1],
    ['getConversation', Number.NaN],
    ['getConversation', Number.POSITIVE_INFINITY],
    ['getConversation', Number.NEGATIVE_INFINITY],
    ['getConversation', 1.5],
    ['getConversation', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects malformed numeric exitCode from %s', async (
    operation,
    exitCode,
  ) => {
    const conversation = { ...CONVERSATION, exitCode };
    const { client } = clientWith({
      listConversations: () =>
        Promise.resolve(successEnvelope({ conversations: [conversation] })),
      getConversation: () =>
        Promise.resolve(successEnvelope({ conversation })),
    });
    const invoke =
      operation === 'listConversations'
        ? () => client.listConversations()
        : () => client.getConversation('conversation-1');

    const error = await caveErrorOf(invoke);

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation,
      retryable: false,
    });
    expect(error.details).toEqual({
      field:
        operation === 'listConversations'
          ? 'data.conversations[0].exitCode'
          : 'data.conversation.exitCode',
    });
  });

  test('requires conversation updatedAt while allowing createdAt to be absent', async () => {
    const withoutCreatedAt = {
      id: 'conversation-2',
      familiarId: 'familiar-2',
      updatedAt: '2026-08-24T02:00:00.000Z',
    };
    const withoutUpdatedAt: Record<string, unknown> = { ...withoutCreatedAt };
    delete withoutUpdatedAt.updatedAt;
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce(
        successEnvelope({ conversations: [withoutCreatedAt] }),
      )
      .mockResolvedValueOnce(
        successEnvelope({ conversations: [withoutUpdatedAt] }),
      );
    const { client } = clientWith({ listConversations });

    await expect(client.listConversations()).resolves.toEqual({
      data: [withoutCreatedAt],
    });
    const error = await caveErrorOf(() => client.listConversations());
    expect(error.details).toEqual({
      field: 'data.conversations[0].updatedAt',
    });
  });

  test('requires message parentId and accepts null', async () => {
    const withoutParentId: Record<string, unknown> = { ...MESSAGE };
    delete withoutParentId.parentId;
    const listConversationMessages = vi
      .fn()
      .mockResolvedValueOnce(successEnvelope({ messages: [MESSAGE] }))
      .mockResolvedValueOnce(
        successEnvelope({ messages: [withoutParentId] }),
      );
    const { client } = clientWith({ listConversationMessages });

    await expect(
      client.listConversationMessages('conversation-1'),
    ).resolves.toMatchObject({
      data: [{ parentId: null }],
    });
    const error = await caveErrorOf(() =>
      client.listConversationMessages('conversation-1'),
    );
    expect(error.details).toEqual({
      field: 'data.messages[0].parentId',
    });
  });

  test.each([
    [
      'data.familiars[0].displayName',
      'listFamiliars',
      { familiars: [{ ...FAMILIAR, displayName: 42 }] },
    ],
    [
      'data.familiars[0].activeSessions',
      'listFamiliars',
      { familiars: [{ ...FAMILIAR, activeSessions: '2' }] },
    ],
    [
      'data.projects[0].root',
      'listProjects',
      { projects: [{ ...PROJECT, root: false }] },
    ],
    [
      'data.conversations[0].pending',
      'listConversations',
      { conversations: [{ ...CONVERSATION, pending: 'false' }] },
    ],
    [
      'data.messages[0].conversationId',
      'listConversationMessages',
      { messages: [{ ...MESSAGE, conversationId: 1 }] },
    ],
    [
      'data.messages[0].attachmentCount',
      'listConversationMessages',
      { messages: [{ ...MESSAGE, attachmentCount: '1' }] },
    ],
    [
      'data.messages[0].toolCount',
      'listConversationMessages',
      { messages: [{ ...MESSAGE, toolCount: null }] },
    ],
  ])('rejects malformed DTO field %s', async (field, operation, data) => {
    const method = vi.fn(() => Promise.resolve(successEnvelope(data)));
    const { client } = clientWith({ [operation]: method });
    const invoke =
      operation === 'listFamiliars'
        ? () => client.listFamiliars()
        : operation === 'listProjects'
          ? () => client.listProjects()
          : operation === 'listConversations'
            ? () => client.listConversations()
            : () => client.listConversationMessages('conversation-1');

    const error = await caveErrorOf(invoke);

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation,
      retryable: false,
    });
    expect(error.details).toEqual({ field });
  });

  test.each([
    ['activeSessions', Number.NaN],
    ['activeSessions', Number.POSITIVE_INFINITY],
    ['activeSessions', -1],
    ['activeSessions', 1.5],
    ['activeSessions', Number.MAX_SAFE_INTEGER + 1],
    ['attachmentCount', Number.NaN],
    ['attachmentCount', Number.POSITIVE_INFINITY],
    ['attachmentCount', -1],
    ['attachmentCount', 1.5],
    ['attachmentCount', Number.MAX_SAFE_INTEGER + 1],
    ['toolCount', Number.NaN],
    ['toolCount', Number.POSITIVE_INFINITY],
    ['toolCount', -1],
    ['toolCount', 1.5],
    ['toolCount', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects malformed count %s value %s', async (field, value) => {
    const familiar = { ...FAMILIAR, [field]: value };
    const message = { ...MESSAGE, [field]: value };
    const operation =
      field === 'activeSessions'
        ? 'listFamiliars'
        : 'listConversationMessages';
    const data =
      field === 'activeSessions'
        ? { familiars: [familiar] }
        : { messages: [message] };
    const method = vi.fn(() => Promise.resolve(successEnvelope(data)));
    const { client } = clientWith({ [operation]: method });
    const invoke =
      operation === 'listFamiliars'
        ? () => client.listFamiliars()
        : () => client.listConversationMessages('conversation-1');

    const error = await caveErrorOf(invoke);

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation,
      retryable: false,
    });
    expect(error.details).toEqual({
      field:
        field === 'activeSessions'
          ? `data.familiars[0].${field}`
          : `data.messages[0].${field}`,
    });
  });

  test.each([
    ['apiVersion', { apiVersion: undefined }],
    ['apiVersion', { apiVersion: 'version-one' }],
    ['minimumClientVersion', { minimumClientVersion: 1 }],
    ['minimumClientVersion', { minimumClientVersion: 'version-one' }],
    ['capabilities', { capabilities: 'projects' }],
    ['capabilities[0]', { capabilities: [1] }],
    ['operations', { operations: undefined }],
    ['operations', { operations: [] }],
    ['operations', { operations: 'projects.list' }],
    [
      'operations[1]',
      { operations: ['projects.list', 'projects.list'] },
    ],
    ['operations[0]', { operations: ['PROJECTS.LIST'] }],
    ['operations[0]', { operations: ['a'.repeat(65)] }],
    ['data', { data: undefined }],
    ['data.projects', { data: { projects: 'not-an-array' } }],
  ])('rejects malformed success envelope field %s', async (
    field,
    replacement,
  ) => {
    const response = {
      ...successEnvelope({ projects: [PROJECT] }),
      ...replacement,
    };
    const { client } = clientWith({
      listProjects: () => Promise.resolve(response),
    });

    const error = await caveErrorOf(() => client.listProjects());

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation: 'listProjects',
      retryable: false,
    });
    expect(error.details).toEqual({ field });
  });

  test.each([
    ['operations', { operations: undefined }],
    ['operations', { operations: [] }],
    ['operations', { operations: 'projects.list' }],
    [
      'operations[1]',
      { operations: ['projects.list', 'projects.list'] },
    ],
    ['operations[0]', { operations: ['PROJECTS.LIST'] }],
    ['operations[0]', { operations: ['a'.repeat(65)] }],
  ])('validates explicit error envelope metadata field %s before normalization', async (
    field,
    replacement,
  ) => {
    const { client } = clientWith({
      listProjects: () =>
        Promise.resolve(errorEnvelope(replacement)),
    });

    const error = await caveErrorOf(() => client.listProjects());

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation: 'listProjects',
      retryable: false,
    });
    expect(error.details).toEqual({ field });
  });

  test.each([
    ['success', '1.1'],
    ['success', '2.0'],
    ['success', 'version-one'],
    ['error', '1.1'],
    ['error', 'version-one'],
  ])('rejects an otherwise-valid %s envelope with apiVersion %s', async (
    envelopeKind,
    apiVersion,
  ) => {
    const response =
      envelopeKind === 'success'
        ? {
            ...successEnvelope({ projects: [PROJECT] }),
            apiVersion,
          }
        : {
            ...errorEnvelope(),
            apiVersion,
          };
    const { client } = clientWith({
      listProjects: () => Promise.resolve(response),
    });

    const error = await caveErrorOf(() => client.listProjects());

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation: 'listProjects',
      retryable: false,
    });
    expect(error.details).toEqual({ field: 'apiVersion' });
  });

  test('preserves incompatible minimum client version metadata', async () => {
    const { client } = clientWith({
      listProjects: () =>
        Promise.resolve({
          ...successEnvelope({ projects: [] }),
          minimumClientVersion: '99.0.0',
        }),
    });

    await expect(client.listProjects()).rejects.toMatchObject({
      normalized: {
        code: 'incompatible_version',
        operation: 'listProjects',
        retryable: false,
      },
    });
  });

  test('rejects malformed detail data with a stable field path', async () => {
    const { client } = clientWith({
      getConversation: () =>
        Promise.resolve(successEnvelope({ conversation: null })),
    });

    const error = await caveErrorOf(() =>
      client.getConversation('conversation-1'),
    );

    expect(error.normalized).toMatchObject({
      code: 'invalid_response',
      operation: 'getConversation',
      retryable: false,
    });
    expect(error.details).toEqual({ field: 'data.conversation' });
  });

  test('parses the optional top-level cursor with core canonical validation', async () => {
    const listProjects = vi
      .fn()
      .mockResolvedValueOnce(
        successEnvelope(
          { projects: [PROJECT] },
          {
            current: CURSOR,
            next: NEXT_CURSOR,
            hasMore: true,
          },
        ),
      )
      .mockResolvedValueOnce(
        successEnvelope(
          { projects: [] },
          { next: 'not canonical', hasMore: true },
        ),
      );
    const { client } = clientWith({ listProjects });

    await expect(client.listProjects()).resolves.toEqual({
      data: [PROJECT],
      cursor: {
        current: CURSOR,
        next: NEXT_CURSOR,
        hasMore: true,
      },
    });
    const error = await caveErrorOf(() => client.listProjects());
    expect(error.details).toEqual({ field: 'cursor.next' });
  });

  test('validates a supplied cursor on detail envelopes', async () => {
    const { client } = clientWith({
      getConversation: () =>
        Promise.resolve({
          ...successEnvelope({ conversation: CONVERSATION }),
          cursor: { hasMore: 'false' },
        }),
    });

    const error = await caveErrorOf(() =>
      client.getConversation('conversation-1'),
    );
    expect(error.details).toEqual({ field: 'cursor.hasMore' });
  });

  test('preserves exact 1.0 explicit Cave error envelopes before success parsing', async () => {
    const events: OperationEvent[] = [];
    const { client } = clientWith(
      {
        listConversationMessages: () =>
          Promise.resolve(
            errorEnvelope({
              error: {
                code: 'reconcile_required',
                message: 'Reload canonical state.',
                retryable: false,
                details: {
                  reason: 'resume_from_canonical_state',
                },
              },
            }),
          ),
      },
      {
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

    const error = await caveErrorOf(() =>
      client.listConversationMessages('conversation-1'),
    );

    expect(error.normalized).toMatchObject({
      code: 'reconcile_required',
      operation: 'listConversationMessages',
      retryable: false,
    });
    expect(error.details).toEqual({
      reason: 'resume_from_canonical_state',
    });
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'failure']);
    expect(events.map(({ operation }) => operation)).toEqual([
      'listConversationMessages',
      'listConversationMessages',
    ]);
  });

  test('validates page options and conversation ids before transport I/O', async () => {
    const listProjects = vi.fn(() =>
      Promise.resolve(successEnvelope({ projects: [] })),
    );
    const getConversation = vi.fn(() =>
      Promise.resolve(successEnvelope({ conversation: CONVERSATION })),
    );
    const listConversationMessages = vi.fn(() =>
      Promise.resolve(successEnvelope({ messages: [] })),
    );
    const { client } = clientWith({
      listProjects,
      getConversation,
      listConversationMessages,
    });

    await expect(client.listProjects({ limit: 0 })).rejects.toMatchObject({
      code: 'invalid_options',
    });
    await expect(
      client.listProjects({ cursor: 'not canonical' }),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(client.getConversation('   ')).rejects.toMatchObject({
      code: 'invalid_options',
    });
    await expect(
      client.listConversationMessages('', {}),
    ).rejects.toMatchObject({ code: 'invalid_options' });
    for (const conversationId of ['.', '..']) {
      await expect(
        client.getConversation(conversationId),
      ).rejects.toMatchObject({
        code: 'invalid_options',
        message: 'conversationId must not be a dot path segment',
      });
      await expect(
        client.listConversationMessages(conversationId),
      ).rejects.toMatchObject({
        code: 'invalid_options',
        message: 'conversationId must not be a dot path segment',
      });
    }

    expect(listProjects).not.toHaveBeenCalled();
    expect(getConversation).not.toHaveBeenCalled();
    expect(listConversationMessages).not.toHaveBeenCalled();
  });

  test('preserves non-dot-only producer ids containing dots', async () => {
    const getConversation = vi.fn<
      (
        conversationId: string,
        context?: OperationContext,
      ) => Promise<unknown>
    >(() =>
      Promise.resolve(successEnvelope({ conversation: CONVERSATION })),
    );
    const listConversationMessages = vi.fn<
      (
        conversationId: string,
        options: PageOptions,
        context?: OperationContext,
      ) => Promise<unknown>
    >(() =>
      Promise.resolve(successEnvelope({ messages: [] })),
    );
    const { client } = clientWith({
      getConversation,
      listConversationMessages,
    });

    await expect(client.getConversation('conversation.v1')).resolves.toEqual(
      CONVERSATION,
    );
    await expect(
      client.listConversationMessages('conversation.v1'),
    ).resolves.toEqual({ data: [] });
    expect(getConversation.mock.calls[0]?.[0]).toBe('conversation.v1');
    expect(listConversationMessages.mock.calls[0]?.[0]).toBe(
      'conversation.v1',
    );
  });

  test('uses one standard observer lifecycle and passes caller controls to the transport', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    let receivedContext: OperationContext | undefined;
    const listProjects = vi.fn(
      (_options, context?: OperationContext) => {
        receivedContext = context;
        return Promise.resolve(successEnvelope({ projects: [] }));
      },
    );
    const { client } = clientWith(
      { listProjects },
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
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'success']);
    expect(events.map(({ operation }) => operation)).toEqual([
      'listProjects',
      'listProjects',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('times out a non-cooperative transport once without retrying', async () => {
    vi.useFakeTimers();
    let context: OperationContext | undefined;
    const listFamiliars = vi.fn(
      (_options, receivedContext?: OperationContext) => {
        context = receivedContext;
        return new Promise<never>(() => undefined);
      },
    );
    const { client } = clientWith({ listFamiliars });
    const caught = client
      .listFamiliars({ timeoutMs: 10 })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(context?.signal.aborted).toBe(true);
    await expect(caught).resolves.toMatchObject({
      normalized: {
        code: 'timeout',
        operation: 'listFamiliars',
        retryable: true,
      },
    });
    expect(listFamiliars).toHaveBeenCalledOnce();
  });

  test('threads caller abort through the transport once', async () => {
    const controller = new AbortController();
    let context: OperationContext | undefined;
    const listConversationMessages = vi.fn(
      (
        _conversationId: string,
        _options: PageOptions,
        receivedContext?: OperationContext,
      ) => {
        context = receivedContext;
        return new Promise<never>(() => undefined);
      },
    );
    const { client } = clientWith({ listConversationMessages });
    const caught = client
      .listConversationMessages('conversation-1', {
        signal: controller.signal,
      })
      .catch((error: unknown) => error);

    controller.abort('caller stopped');

    expect(context?.signal.aborted).toBe(true);
    await expect(caught).resolves.toMatchObject({
      normalized: {
        code: 'aborted',
        operation: 'listConversationMessages',
        retryable: false,
      },
    });
    expect(listConversationMessages).toHaveBeenCalledOnce();
  });

  test('performs no discovery, credential, bearer, or retry side effects', async () => {
    const store = createMemorySecretStore();
    const get = vi.spyOn(store, 'get');
    const set = vi.spyOn(store, 'set');
    const listProjects = vi.fn<
      (options: PageOptions, context?: OperationContext) => Promise<unknown>
    >(() =>
      Promise.reject(
        Object.assign(new Error('offline'), {
          code: 'service_unavailable',
          retryable: true,
        }),
      ),
    );
    const health = vi.fn(() => Promise.resolve(VALID_HEALTH_RESPONSE));
    const transport = {
      health,
      listProjects,
      pairingExchange: () =>
        Promise.reject(new Error('canonical reads must not pair')),
    } satisfies CaveCredentialPersistingTransport;
    const client = new CaveClient({
      transport,
      credentials: {
        store,
        reference: createSecretStoreReference('canonical-read-test'),
      },
    });

    const error = await caveErrorOf(() => client.listProjects());

    expect(error.normalized).toMatchObject({
      code: 'service_unavailable',
      operation: 'listProjects',
      retryable: true,
    });
    expect(listProjects).toHaveBeenCalledOnce();
    expect(listProjects.mock.calls[0]?.[0]).toEqual({ limit: 50 });
    expect(health).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
