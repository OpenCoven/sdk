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

const CURSOR = 'eyJwYWdlIjoyfQ';
const NEXT_CURSOR = 'eyJwYWdlIjozfQ';

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
    data,
    ...(cursor === undefined ? {} : { cursor }),
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
    ['apiVersion', { apiVersion: undefined }],
    ['apiVersion', { apiVersion: 'version-one' }],
    ['minimumClientVersion', { minimumClientVersion: 1 }],
    ['minimumClientVersion', { minimumClientVersion: 'version-one' }],
    ['capabilities', { capabilities: 'projects' }],
    ['capabilities[0]', { capabilities: [1] }],
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
    { apiVersion: '2.0' },
    { minimumClientVersion: '99.0.0' },
  ])('preserves incompatible version metadata', async (replacement) => {
    const { client } = clientWith({
      listProjects: () =>
        Promise.resolve({
          ...successEnvelope({ projects: [] }),
          ...replacement,
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

  test('preserves resolved explicit Cave error envelopes before success parsing', async () => {
    const events: OperationEvent[] = [];
    const { client } = clientWith(
      {
        listConversationMessages: () =>
          Promise.resolve({
            apiVersion: '1.0',
            minimumClientVersion: '0.1.0',
            capabilities: ['conversation-messages'],
            error: {
              code: 'reconcile_required',
              message: 'Reload canonical state.',
              retryable: false,
              details: {
                reason: 'resume_from_canonical_state',
              },
            },
          }),
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

    expect(listProjects).not.toHaveBeenCalled();
    expect(getConversation).not.toHaveBeenCalled();
    expect(listConversationMessages).not.toHaveBeenCalled();
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
