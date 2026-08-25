import {
  createManagedCaveClient,
  type CaveManagedNativeDiscardResult,
  type CaveManagedNativeResponse,
  type CaveManagedNativeTransport,
  type CavePairingRequest,
} from '@opencoven/cave-client';

const REQUEST_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const CREDENTIAL_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba002';
const INSTANCE_ID = '00000000-0000-4000-8000-000000000000';
const EXPIRES_AT = 1_755_731_112_617;
const PAIRING_SECRET = 'native-only-pairing-secret';
const BEARER = 'native-only-bearer';

function safeGet(value: unknown, key: PropertyKey): unknown {
  return typeof value === 'object' && value !== null
    ? (Reflect.get(value, key) as unknown)
    : undefined;
}

function success(
  data: Record<string, unknown>,
  metadata: {
    capabilities?: string[];
    operations?: string[];
    cursor?: Record<string, unknown>;
  } = {},
): CaveManagedNativeResponse {
  return {
    statusCode: 200,
    payload: {
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: metadata.capabilities ?? ['health', 'pairing'],
      operations: metadata.operations ?? [
        'health.read',
        'pairing.create',
        'pairing.poll',
        'pairing.exchange',
      ],
      data,
      ...(metadata.cursor === undefined
        ? {}
        : { cursor: metadata.cursor }),
    },
  };
}

class FakeNativeCave implements CaveManagedNativeTransport {
  #pairingSecret: string | undefined;
  #stagedBearer: string | undefined;
  #committedBearer: string | undefined;

  health(): Promise<CaveManagedNativeResponse> {
    return Promise.resolve(
      success({
        instanceId: INSTANCE_ID,
        pairingRequired: this.#committedBearer === undefined,
        releaseVersion: '0.3.10',
      }),
    );
  }

  pairingCreate(request: CavePairingRequest) {
    if (request.installationId.length === 0) {
      return Promise.reject(new Error('Installation ID is required.'));
    }
    this.#pairingSecret = PAIRING_SECRET;
    return Promise.resolve({
      handle: 'native-pairing-handle',
      response: success({
        requestId: REQUEST_ID,
        expiresAt: EXPIRES_AT,
      }),
    });
  }

  pairingPoll(handle: string): Promise<CaveManagedNativeResponse> {
    this.#requirePairing(handle);
    return Promise.resolve(
      success({
        id: REQUEST_ID,
        status: 'approved',
        expiresAt: EXPIRES_AT,
      }),
    );
  }

  pairingExchange(handle: string) {
    this.#requirePairing(handle);
    this.#pairingSecret = undefined;
    this.#stagedBearer = BEARER;
    return Promise.resolve({
      authorityBinding: {
        version: 1,
        instanceId: INSTANCE_ID,
        endpoint: {
          kind: 'http',
          url: 'http://127.0.0.1:3020',
        },
        record: {
          identity: `sha256:${'a'.repeat(64)}`,
          device: 7,
          inode: 11,
        },
        freshness: {
          pid: 4_321,
          nonce: 'fake-native-cave',
          startedAt: '2026-08-24T02:03:51.419Z',
        },
      },
      commitHandle: 'native-commit-handle',
      response: success({
        credential: {
          id: CREDENTIAL_ID,
          appName: 'OpenCoven Chat',
          installationId: 'chat-install-1',
          scopes: ['chat:read'],
          createdAt: 1_755_730_812_617,
          lastUsedAt: null,
          revokedAt: null,
          revocationReason: null,
        },
      }),
    });
  }

  pairingCommit(commitHandle: string): Promise<void> {
    if (
      commitHandle !== 'native-commit-handle' ||
      this.#stagedBearer === undefined
    ) {
      return Promise.reject(new Error('No staged credential.'));
    }
    this.#committedBearer = this.#stagedBearer;
    this.#stagedBearer = undefined;
    return Promise.resolve();
  }

  pairingDiscard(
    commitHandle: string,
  ): Promise<CaveManagedNativeDiscardResult> {
    if (commitHandle !== 'native-commit-handle') {
      return Promise.resolve('changed');
    }
    if (this.#stagedBearer === undefined) {
      return Promise.resolve('absent');
    }
    this.#stagedBearer = undefined;
    return Promise.resolve('deleted');
  }

  credentialState(): Promise<unknown> {
    return Promise.resolve({
      status:
        this.#committedBearer === undefined ? 'missing' : 'present',
    });
  }

  forgetCredential(): Promise<unknown> {
    return Promise.reject(
      Object.assign(new Error(BEARER), {
        code: PAIRING_SECRET,
        details: {
          bearer: BEARER,
          secret: PAIRING_SECRET,
        },
      }),
    );
  }

  familiars(): Promise<CaveManagedNativeResponse> {
    this.#requireCredential();
    return Promise.resolve(
      success({
        familiars: [
          {
            id: 'cody',
            display_name: 'Cody',
            role: 'Implementation',
          },
        ],
      }),
    );
  }

  listFamiliars(): Promise<CaveManagedNativeResponse> {
    this.#requireCredential();
    return Promise.resolve(
      success(
        {
          familiars: [
            {
              id: 'familiar-1',
              displayName: 'Cody',
              role: 'implementation',
              description: 'Implementation familiar',
              pronouns: 'they/them',
              status: 'active',
              lastSeenAt: '2026-08-24T01:00:00.000Z',
              activeSessions: 1,
            },
          ],
        },
        {
          capabilities: ['familiars', 'cursors'],
          operations: ['familiars.list'],
          cursor: { hasMore: false },
        },
      ),
    );
  }

  listProjects(): Promise<CaveManagedNativeResponse> {
    this.#requireCredential();
    return Promise.resolve(
      success(
        {
          projects: [
            {
              id: 'project-1',
              name: 'OpenCoven SDK',
              root: '/workspace/sdk',
              createdAt: '2026-08-24T00:00:00.000Z',
              updatedAt: '2026-08-24T01:00:00.000Z',
            },
          ],
        },
        {
          capabilities: ['projects', 'cursors'],
          operations: ['projects.list'],
          cursor: { hasMore: false },
        },
      ),
    );
  }

  listConversations(): Promise<CaveManagedNativeResponse> {
    this.#requireCredential();
    return Promise.resolve(
      success(
        {
          conversations: [
            {
              id: 'conversation-1',
              familiarId: 'familiar-1',
              harness: 'copilot',
              model: 'gpt-5',
              runtime: 'cli',
              title: 'Managed native verification',
              origin: 'example',
              status: 'complete',
              exitCode: 0,
              pending: false,
              createdAt: '2026-08-24T00:00:00.000Z',
              updatedAt: '2026-08-24T01:00:00.000Z',
            },
          ],
        },
        {
          capabilities: ['conversations', 'cursors'],
          operations: ['conversations.list'],
          cursor: { hasMore: false },
        },
      ),
    );
  }

  getConversation(
    conversationId: string,
  ): Promise<CaveManagedNativeResponse> {
    this.#requireCredential();
    return Promise.resolve(
      success(
        {
          conversation: {
            id: conversationId,
            familiarId: 'familiar-1',
            harness: 'copilot',
            model: 'gpt-5',
            runtime: 'cli',
            title: 'Managed native verification',
            origin: 'example',
            status: 'complete',
            exitCode: 0,
            pending: false,
            createdAt: '2026-08-24T00:00:00.000Z',
            updatedAt: '2026-08-24T01:00:00.000Z',
          },
        },
        {
          capabilities: ['conversations'],
          operations: ['conversations.read'],
        },
      ),
    );
  }

  listConversationMessages(): Promise<CaveManagedNativeResponse> {
    this.#requireCredential();
    return Promise.resolve(
      success(
        {
          messages: [
            {
              id: 'message-1',
              conversationId: 'conversation-1',
              parentId: null,
              role: 'user',
              text: 'Verify managed native custody.',
              createdAt: '2026-08-24T00:30:00.000Z',
              attachmentCount: 0,
              toolCount: 0,
              isError: false,
              cancelled: false,
            },
          ],
        },
        {
          capabilities: ['conversation-messages', 'cursors'],
          operations: ['messages.list'],
          cursor: { hasMore: false },
        },
      ),
    );
  }

  hasCommittedBearer(): boolean {
    return this.#committedBearer === BEARER;
  }

  #requirePairing(handle: string): void {
    if (
      handle !== 'native-pairing-handle' ||
      this.#pairingSecret !== PAIRING_SECRET
    ) {
      throw new Error('Pairing state is unavailable.');
    }
  }

  #requireCredential(): void {
    if (this.#committedBearer !== BEARER) {
      throw new Error('Credential is unavailable.');
    }
  }
}

const native = new FakeNativeCave();
const events: unknown[] = [];
const observerErrors: unknown[] = [];
const cave = createManagedCaveClient({
  operation: {
    timeoutMs: 1_000,
    observer: {
      onEvent(event) {
        events.push(event);
      },
      onObserverError(error) {
        observerErrors.push(error);
      },
    },
  },
  transport: native,
});

const session = await cave.createPairing({
  appName: 'OpenCoven Chat',
  installationId: 'chat-install-1',
  scopes: ['chat:read'],
});
const pairing = await session.poll();
const credential = await session.exchange();
const status = await cave.credentialStatus();
const familiars = await cave.listFamiliars();
const projects = await cave.listProjects();
const conversations = await cave.listConversations();
const conversation = await cave.getConversation('conversation-1');
const messages = await cave.listConversationMessages('conversation-1');

let replayError: unknown;
try {
  await session.exchange();
} catch (error: unknown) {
  replayError = error;
}

let nativeFailure: unknown;
try {
  await cave.forgetCredential();
} catch (error: unknown) {
  const cause = safeGet(error, 'cause');
  nativeFailure = {
    causeCode: safeGet(cause, 'code'),
    causeDetails: safeGet(cause, 'details'),
    causeMessage: safeGet(cause, 'message'),
    code: safeGet(error, 'code'),
    details: safeGet(error, 'details'),
    message: safeGet(error, 'message'),
    normalized: safeGet(error, 'normalized'),
  };
}

const snapshot = JSON.stringify({
  client: cave,
  conversation,
  conversations,
  credential,
  events,
  familiars,
  messages,
  nativeFailure,
  observerErrors,
  pairing,
  projects,
  replayError,
  session,
  status,
});
if (
  snapshot.includes(PAIRING_SECRET) ||
  snapshot.includes(BEARER) ||
  replayError === undefined ||
  nativeFailure === undefined ||
  !native.hasCommittedBearer()
) {
  throw new Error(
    `Managed native secret custody verification failed: pairing=${String(
      snapshot.includes(PAIRING_SECRET),
    )}, bearer=${String(snapshot.includes(BEARER))}, replay=${String(
      replayError !== undefined,
    )}, nativeFailure=${String(nativeFailure !== undefined)}, custody=${String(
      native.hasCommittedBearer(),
    )}.`,
  );
}

process.stdout.write('Managed native Cave example passed.\n');
