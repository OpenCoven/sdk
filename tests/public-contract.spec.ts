import * as cave from '@opencoven/cave-client';
import * as coven from '@opencoven/coven-client';
import * as cli from '@opencoven/dev-cli';
import * as sdk from '@opencoven/sdk';
import * as core from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type CaveCanonicalFamiliarContract = Assert<Equal<
  cave.CaveCanonicalFamiliar,
  {
    id: string;
    name: string;
    repository: string;
    displayName: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  }
>>;
type CaveProjectContract = Assert<Equal<
  cave.CaveProject,
  {
    id: string;
    name: string;
    familiarIds: readonly string[];
    repository: string;
    defaultBranch: string;
    createdAt: string;
    updatedAt: string;
  }
>>;
type CaveConversationContract = Assert<Equal<
  cave.CaveConversation,
  {
    id: string;
    familiarId: string;
    projectId?: string;
    title?: string;
    createdAt?: string;
    updatedAt: string;
  }
>>;
type CaveConversationDetailContract = Assert<Equal<
  cave.CaveConversationDetail,
  {
    id: string;
    familiarId: string;
    projectId?: string;
    title?: string;
    createdAt?: string;
    updatedAt: string;
    metadata: Record<string, unknown>;
    branchId: string;
    headMessageId?: string;
    state: {
      activePath: readonly string[];
      currentVersion: number;
      baseVersion: number;
    };
  }
>>;
type CaveMessageContract = Assert<Equal<
  cave.CaveMessage,
  {
    id: string;
    parentId: string | null;
    type: string;
    content: string;
    createdAt: string;
    familiarId?: string;
    metadata?: Record<string, unknown>;
  }
>>;
type CaveReadTransportContract = Assert<Equal<
  cave.CaveReadTransport['getJson'],
  (
    path: string,
    options?: core.OperationContext,
  ) => Promise<unknown>
>>;
type ListCanonicalFamiliarsContract = Assert<Equal<
  cave.CaveClient['listCanonicalFamiliars'],
  (
    options?: cave.CaveCanonicalReadOptions,
  ) => Promise<core.Page<cave.CaveCanonicalFamiliar>>
>>;
type ListProjectsContract = Assert<Equal<
  cave.CaveClient['listProjects'],
  (
    options?: cave.CaveCanonicalReadOptions,
  ) => Promise<core.Page<cave.CaveProject>>
>>;
type ListConversationsContract = Assert<Equal<
  cave.CaveClient['listConversations'],
  (
    options?: cave.CaveCanonicalReadOptions,
  ) => Promise<core.Page<cave.CaveConversation>>
>>;
type GetConversationContract = Assert<Equal<
  cave.CaveClient['getConversation'],
  (
    conversationId: string,
    options?: core.OperationOptions,
  ) => Promise<cave.CaveConversationDetail>
>>;
type ListMessagesContract = Assert<Equal<
  cave.CaveClient['listMessages'],
  (
    conversationId: string,
    options?: cave.CaveCanonicalReadOptions,
  ) => Promise<core.Page<cave.CaveMessage>>
>>;

function canonicalReadCompileOnly(
  client: cave.CaveClient,
  transport: cave.CaveReadTransport,
): void {
  const familiars: Promise<core.Page<cave.CaveCanonicalFamiliar>> =
    client.listCanonicalFamiliars();
  const projects: Promise<core.Page<cave.CaveProject>> =
    client.listProjects({ limit: 25 });
  const conversations: Promise<core.Page<cave.CaveConversation>> =
    client.listConversations({ cursor: 'eyJwYWdlIjoyfQ' });
  const conversation: Promise<cave.CaveConversationDetail> =
    client.getConversation('conversation-1');
  const messages: Promise<core.Page<cave.CaveMessage>> =
    client.listMessages('conversation-1', { timeoutMs: 100 });

  void new cave.CaveClient({
    transport: {
      health: () => Promise.reject(new Error('compile only')),
    },
    readTransport: transport,
  });
  void familiars;
  void projects;
  void conversations;
  void conversation;
  void messages;
}

void (undefined as unknown as CaveCanonicalFamiliarContract);
void (undefined as unknown as CaveProjectContract);
void (undefined as unknown as CaveConversationContract);
void (undefined as unknown as CaveConversationDetailContract);
void (undefined as unknown as CaveMessageContract);
void (undefined as unknown as CaveReadTransportContract);
void (undefined as unknown as ListCanonicalFamiliarsContract);
void (undefined as unknown as ListProjectsContract);
void (undefined as unknown as ListConversationsContract);
void (undefined as unknown as GetConversationContract);
void (undefined as unknown as ListMessagesContract);
void canonicalReadCompileOnly;

interface NormalizedError {
  system: 'cave' | 'coven';
  code: string;
  retryable: boolean;
  operation: string;
}

type ErrorNormalizer = (error: unknown, operation: string) => NormalizedError;

function hasFunction(value: object, key: string): boolean {
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'function';
}

function exportedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe('public package entry points', () => {
  test('exports the exact supported public SDK surfaces', () => {
    expect(exportedKeys(core)).toEqual([
      'DISCOVERY_PROFILES',
      'DISCOVERY_PROTOCOL',
      'DISCOVERY_RECORD_VERSION',
      'DiscoveryContractError',
      'InvalidSecretKeyError',
      'OperationAbortedError',
      'OperationConfigurationError',
      'OperationTimeoutError',
      'SecretStoreDisposedError',
      'assessCompatibility',
      'createManagedMemorySecretStore',
      'createMemorySecretStore',
      'createOperationScope',
      'createSecretStoreReference',
      'isOperationAbortedError',
      'isOperationTimeoutError',
      'iteratePages',
      'normalizeError',
      'normalizePageOptions',
      'parseDiscoveryEndpoint',
      'parseDiscoveryRecord',
      'runOperation',
    ]);
    expect(exportedKeys(cave)).toEqual([
      'CAVE_ANALYTICS_WINDOWS',
      'CAVE_CLIENT_VERSION',
      'CAVE_FAMILIAR_PROPERTIES',
      'CAVE_PAIRING_SCOPES',
      'CAVE_PAIRING_STATUSES',
      'CaveClient',
      'CaveClientError',
      'CaveDiscoveryError',
      'CavePairingSession',
      'createCaveClient',
      'createDiscoveredCaveClient',
      'digestCaveContractFixture',
      'discoverCaveEndpoint',
      'isCaveClientError',
      'isCaveDiscoveryError',
      'normalizeCaveError',
      'parseCaveContractFixture',
      'parseVerifiedCaveContractFixture',
      'verifyCaveContractFixtureDigest',
    ]);
    expect(exportedKeys(coven)).toEqual([
      'COVEN_DAEMON_PROTOCOL',
      'CovenClient',
      'CovenClientError',
      'CovenDaemonResponseError',
      'CovenIpcError',
      'createCovenClient',
      'createCovenUnixTransport',
      'createCovenWindowsTransport',
      'createDiscoveredCovenClient',
      'discoverCovenEndpoint',
      'isCovenClientError',
      'isCovenDaemonResponseError',
      'isCovenIpcError',
      'normalizeCovenError',
    ]);
    expect(exportedKeys(sdk)).toEqual([
      'OpenCovenSdk',
      'OpenCovenSdkError',
      'createOpenCovenSdk',
    ]);
    expect(exportedKeys(cli)).toEqual([
      'CLI_USAGE',
      'DEV_CLI_VERSION',
      'SecureStoreUnavailableError',
      'createNativeSecretStore',
      'formatCliOutput',
      'main',
      'runCli',
    ]);

    expect(hasFunction(core, 'createMemorySecretStore')).toBe(true);
    expect(hasFunction(cave, 'CaveClient')).toBe(true);
    expect(hasFunction(coven, 'createCovenUnixTransport')).toBe(true);
    expect(hasFunction(sdk, 'createOpenCovenSdk')).toBe(true);
    expect(hasFunction(cli, 'runCli')).toBe(true);
  });

  test('exposes additive unified health reporting', () => {
    const instance = sdk.createOpenCovenSdk({});

    expect(instance.healthReport.bind(instance)).toBeTypeOf('function');
  });

  test('adds pairing and credential helpers without removing existing Cave APIs', () => {
    const client = new cave.CaveClient({
      transport: {
        health: () =>
          Promise.resolve({
            apiVersion: '1.0',
            minimumClientVersion: '0.1.0',
            capabilities: ['health'],
            operations: ['health.read'],
            data: {
              instanceId: 'public-contract-cave',
              pairingRequired: true,
              releaseVersion: '0.1.0',
            },
          }),
      },
      credentials: {
        store: core.createMemorySecretStore(),
        reference: core.createSecretStoreReference('cave-credential'),
      },
    });

    expect(client.createPairing.bind(client)).toBeTypeOf('function');
    expect(client.credentialStatus.bind(client)).toBeTypeOf('function');
    expect(client.forgetCredential.bind(client)).toBeTypeOf('function');
    expect((cave as { CAVE_PAIRING_SCOPES?: unknown }).CAVE_PAIRING_SCOPES).toEqual(
      expect.any(Array),
    );
    expect(client.familiars.bind(client)).toBeTypeOf('function');
    expect(client.familiarAnalytics.bind(client)).toBeTypeOf('function');
    expect(client.listCanonicalFamiliars.bind(client)).toBeTypeOf('function');
    expect(client.listProjects.bind(client)).toBeTypeOf('function');
    expect(client.listConversations.bind(client)).toBeTypeOf('function');
    expect(client.getConversation.bind(client)).toBeTypeOf('function');
    expect(client.listMessages.bind(client)).toBeTypeOf('function');
  });

  test('normalizes Cave unauthorized errors with an explicit operation', () => {
    const normalizeCaveError = (cave as { normalizeCaveError?: ErrorNormalizer }).normalizeCaveError;
    const normalized = normalizeCaveError?.({ code: 'unauthorized' }, 'health');

    expect(normalized).toEqual({
      system: 'cave',
      code: 'unauthorized',
      retryable: false,
      operation: 'health',
      message: 'Cave health request failed',
    });
  });

  test('normalizes Coven errors without inferring discovery or credentials', () => {
    const normalizeCovenError = (coven as { normalizeCovenError?: ErrorNormalizer }).normalizeCovenError;
    const normalized = normalizeCovenError?.({ code: 'session_not_live' }, 'health');

    expect(normalized).toEqual({
      system: 'coven',
      code: 'session_not_live',
      retryable: false,
      operation: 'health',
      message: 'Coven health request failed',
    });
  });
});
