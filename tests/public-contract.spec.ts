import * as cave from '@opencoven/cave-client';
import * as caveManaged from '@opencoven/cave-client/managed';
import * as coven from '@opencoven/coven-client';
import * as cli from '@opencoven/dev-cli';
import * as sdk from '@opencoven/sdk';
import * as core from '@opencoven/sdk-core';
import * as coreBrowser from '@opencoven/sdk-core/browser';
import { describe, expect, test } from 'vitest';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type OpenCovenDiagnosticCheckIdContract = Assert<Equal<
  core.OpenCovenDiagnosticCheckId,
  | 'cave.discovery'
  | 'cave.health'
  | 'secure-store'
  | 'coven.discovery'
  | 'coven.health'
>>;
type OpenCovenDiagnosticStatusContract = Assert<Equal<
  core.OpenCovenDiagnosticStatus,
  'ok' | 'error' | 'skipped'
>>;
type CaveHealthDiagnosticInputContract = Assert<Equal<
  Extract<
    core.OpenCovenDiagnosticCheckInput,
    { readonly id: 'cave.health'; readonly status: 'ok' }
  >,
  {
    readonly id: 'cave.health';
    readonly status: 'ok';
    readonly observedAt: string;
    readonly health: unknown;
  }
>>;

type OpenCovenProfileContract = Assert<Equal<
  core.OpenCovenProfile,
  {
    readonly version: 1;
    readonly name: string;
    readonly caveHome?: string;
    readonly covenHome?: string;
    readonly defaultFamiliarId?: string;
    readonly defaultProjectId?: string;
  }
>>;
type FileOpenCovenProfileStoreOptionsContract = Assert<Equal<
  core.FileOpenCovenProfileStoreOptions,
  {
    readonly path: string;
  }
>>;
type OpenCovenProfileErrorCodeContract = Assert<Equal<
  core.OpenCovenProfileErrorCode,
  | 'corrupt_profile_store'
  | 'invalid_profile'
  | 'invalid_profile_store_path'
  | 'profile_platform_security_unavailable'
  | 'profile_store_read_failed'
  | 'profile_store_write_failed'
  | 'unsafe_profile_store'
>>;

type CaveCanonicalFamiliarContract = Assert<Equal<
  cave.CaveCanonicalFamiliar,
  {
    id: string;
    displayName: string;
    role: string;
    description?: string;
    pronouns?: string;
    status?: string;
    lastSeenAt?: string;
    activeSessions?: number;
  }
>>;
type CaveProjectContract = Assert<Equal<
  cave.CaveProject,
  {
    id: string;
    name: string;
    root: string;
    color?: string;
    repoUrl?: string;
    createdAt: string;
    updatedAt: string;
  }
>>;
type CaveConversationContract = Assert<Equal<
  cave.CaveConversation,
  {
    id: string;
    familiarId: string;
    harness?: string;
    model?: string;
    runtime?: string;
    title?: string;
    origin?: string;
    status?: string;
    exitCode?: number | null;
    pending?: boolean;
    createdAt?: string;
    updatedAt: string;
  }
>>;
type CaveConversationMessageContract = Assert<Equal<
  cave.CaveConversationMessage,
  {
    id: string;
    conversationId: string;
    parentId: string | null;
    role: string;
    text: string;
    createdAt: string;
    attachmentCount: number;
    toolCount: number;
    isError?: boolean;
    cancelled?: boolean;
  }
>>;
type CaveListFamiliarsTransportContract = Assert<Equal<
  NonNullable<cave.CaveTransport['listFamiliars']>,
  (
    options: core.PageOptions,
    context?: core.OperationContext,
  ) => Promise<unknown>
>>;
type CaveListProjectsTransportContract = Assert<Equal<
  NonNullable<cave.CaveTransport['listProjects']>,
  (
    options: core.PageOptions,
    context?: core.OperationContext,
  ) => Promise<unknown>
>>;
type CaveListConversationsTransportContract = Assert<Equal<
  NonNullable<cave.CaveTransport['listConversations']>,
  (
    options: core.PageOptions,
    context?: core.OperationContext,
  ) => Promise<unknown>
>>;
type CaveGetConversationTransportContract = Assert<Equal<
  NonNullable<cave.CaveTransport['getConversation']>,
  (
    conversationId: string,
    context?: core.OperationContext,
  ) => Promise<unknown>
>>;
type CaveListConversationMessagesTransportContract = Assert<Equal<
  NonNullable<cave.CaveTransport['listConversationMessages']>,
  (
    conversationId: string,
    options: core.PageOptions,
    context?: core.OperationContext,
  ) => Promise<unknown>
>>;
type ListFamiliarsContract = Assert<Equal<
  cave.CaveClient['listFamiliars'],
  (
    options?: core.PageOptions & core.OperationOptions,
  ) => Promise<core.Page<cave.CaveCanonicalFamiliar>>
>>;
type ListProjectsContract = Assert<Equal<
  cave.CaveClient['listProjects'],
  (
    options?: core.PageOptions & core.OperationOptions,
  ) => Promise<core.Page<cave.CaveProject>>
>>;
type ListConversationsContract = Assert<Equal<
  cave.CaveClient['listConversations'],
  (
    options?: core.PageOptions & core.OperationOptions,
  ) => Promise<core.Page<cave.CaveConversation>>
>>;
type GetConversationContract = Assert<Equal<
  cave.CaveClient['getConversation'],
  (
    conversationId: string,
    options?: core.OperationOptions,
  ) => Promise<cave.CaveConversation>
>>;
type ListConversationMessagesContract = Assert<Equal<
  cave.CaveClient['listConversationMessages'],
  (
    conversationId: string,
    options?: core.PageOptions & core.OperationOptions,
  ) => Promise<core.Page<cave.CaveConversationMessage>>
>>;
type IterateFamiliarsContract = Assert<Equal<
  cave.CaveClient['iterateFamiliars'],
  (
    options: core.BoundedPageOptions,
  ) => AsyncGenerator<cave.CaveCanonicalFamiliar>
>>;
type IterateProjectsContract = Assert<Equal<
  cave.CaveClient['iterateProjects'],
  (
    options: core.BoundedPageOptions,
  ) => AsyncGenerator<cave.CaveProject>
>>;
type IterateConversationsContract = Assert<Equal<
  cave.CaveClient['iterateConversations'],
  (
    options: core.BoundedPageOptions,
  ) => AsyncGenerator<cave.CaveConversation>
>>;
type IterateConversationMessagesContract = Assert<Equal<
  cave.CaveClient['iterateConversationMessages'],
  (
    conversationId: string,
    options: core.BoundedPageOptions,
  ) => AsyncGenerator<cave.CaveConversationMessage>
>>;
type CaveManagedPairingCreatedContract = Assert<Equal<
  cave.CaveManagedPairingCreated,
  {
    requestId: string;
    expiresAt: number;
  }
>>;
type CaveManagedPairingExchangeContract = Assert<Equal<
  cave.CaveManagedPairingExchange,
  {
    credential: cave.CaveCredentialMetadata;
  }
>>;
type CaveManagedPairingCreateTransportContract = Assert<Equal<
  cave.CaveManagedCredentialTransport['managedPairingCreate'],
  (
    request: cave.CavePairingRequest,
    context?: core.OperationContext,
  ) => Promise<unknown>
>>;
type CaveManagedForgetTransportContract = Assert<Equal<
  cave.CaveManagedCredentialTransport['managedForgetCredential'],
  (
    context?: core.OperationContext,
  ) => Promise<unknown>
>>;
type CaveManagedBrowserFactoryContract = Assert<Equal<
  typeof caveManaged.createManagedCaveClient,
  (
    options: caveManaged.CaveManagedClientOptions,
  ) => cave.CaveClient
>>;
type CaveManagedDiscoverySourceContract = Assert<Equal<
  caveManaged.CaveManagedDiscoverySource,
  {
    read(context?: core.OperationContext): Promise<unknown>;
  }
>>;

function canonicalReadCompileOnly(
  client: cave.CaveClient,
  transport: cave.CaveTransport,
): void {
  const familiars: Promise<core.Page<cave.CaveCanonicalFamiliar>> =
    client.listFamiliars();
  const projects: Promise<core.Page<cave.CaveProject>> =
    client.listProjects({ limit: 25 });
  const conversations: Promise<core.Page<cave.CaveConversation>> =
    client.listConversations({ cursor: 'eyJwYWdlIjoyfQ' });
  const conversation: Promise<cave.CaveConversation> =
    client.getConversation('conversation-1');
  const messages: Promise<core.Page<cave.CaveConversationMessage>> =
    client.listConversationMessages('conversation-1', { timeoutMs: 100 });
  const familiarIterator: AsyncGenerator<cave.CaveCanonicalFamiliar> =
    client.iterateFamiliars({ maxPages: 1 });
  const projectIterator: AsyncGenerator<cave.CaveProject> =
    client.iterateProjects({ signal: new AbortController().signal });
  const conversationIterator: AsyncGenerator<cave.CaveConversation> =
    client.iterateConversations({ maxPages: 1, limit: 25 });
  const messageIterator: AsyncGenerator<cave.CaveConversationMessage> =
    client.iterateConversationMessages('conversation-1', { maxPages: 1 });

  void new cave.CaveClient({ transport });
  void familiars;
  void projects;
  void conversations;
  void conversation;
  void messages;
  void familiarIterator;
  void projectIterator;
  void conversationIterator;
  void messageIterator;
}

function managedNativeCustodyCompileOnly(
  transport: cave.CaveManagedCredentialTransport,
): void {
  const client = new cave.CaveClient({
    transport,
    credentialCustody: { mode: 'managed-native' },
  });
  const session: Promise<cave.CavePairingSession> = client.createPairing({
    appName: 'OpenCoven Chat',
    installationId: 'chat-install-1',
    scopes: ['chat:read'],
  });
  const status: Promise<cave.CaveCredentialStatus> = client.credentialStatus();
  const forgotten: Promise<boolean> = client.forgetCredential();
  const created: Promise<unknown> = transport.managedPairingCreate({
    appName: 'OpenCoven Chat',
    installationId: 'chat-install-1',
    scopes: ['chat:read'],
  });

  // @ts-expect-error Managed native custody cannot be combined with a JS SecretStore.
  void new cave.CaveClient({
    transport,
    credentialCustody: { mode: 'managed-native' },
    credentials: {
      store: core.createMemorySecretStore(),
      reference: core.createSecretStoreReference('managed-native-contract'),
    },
  });

  void session;
  void status;
  void forgotten;
  void created;
}

function managedBrowserCompileOnly(
  transport: caveManaged.CaveManagedCredentialTransport,
  source: caveManaged.CaveManagedDiscoverySource,
): void {
  const client: cave.CaveClient = caveManaged.createManagedCaveClient({
    transport,
  });
  const endpoint: Promise<caveManaged.CaveManagedDiscoveredEndpoint> =
    caveManaged.discoverManagedCaveEndpoint(source);
  const page = coreBrowser.normalizePageOptions({ limit: 25 });

  void client;
  void endpoint;
  void page;
}

void (undefined as unknown as CaveCanonicalFamiliarContract);
void (undefined as unknown as OpenCovenDiagnosticCheckIdContract);
void (undefined as unknown as OpenCovenDiagnosticStatusContract);
void (undefined as unknown as CaveHealthDiagnosticInputContract);
void (undefined as unknown as OpenCovenProfileContract);
void (undefined as unknown as FileOpenCovenProfileStoreOptionsContract);
void (undefined as unknown as OpenCovenProfileErrorCodeContract);
void (undefined as unknown as CaveProjectContract);
void (undefined as unknown as CaveConversationContract);
void (undefined as unknown as CaveConversationMessageContract);
void (undefined as unknown as CaveListFamiliarsTransportContract);
void (undefined as unknown as CaveListProjectsTransportContract);
void (undefined as unknown as CaveListConversationsTransportContract);
void (undefined as unknown as CaveGetConversationTransportContract);
void (undefined as unknown as CaveListConversationMessagesTransportContract);
void (undefined as unknown as ListFamiliarsContract);
void (undefined as unknown as ListProjectsContract);
void (undefined as unknown as ListConversationsContract);
void (undefined as unknown as GetConversationContract);
void (undefined as unknown as ListConversationMessagesContract);
void (undefined as unknown as IterateFamiliarsContract);
void (undefined as unknown as IterateProjectsContract);
void (undefined as unknown as IterateConversationsContract);
void (undefined as unknown as IterateConversationMessagesContract);
void (undefined as unknown as CaveManagedPairingCreatedContract);
void (undefined as unknown as CaveManagedPairingExchangeContract);
void (undefined as unknown as CaveManagedPairingCreateTransportContract);
void (undefined as unknown as CaveManagedForgetTransportContract);
void (undefined as unknown as CaveManagedBrowserFactoryContract);
void (undefined as unknown as CaveManagedDiscoverySourceContract);
void canonicalReadCompileOnly;
void managedNativeCustodyCompileOnly;
void managedBrowserCompileOnly;

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
      'OPENCOVEN_DIAGNOSTIC_VERSION',
      'OPENCOVEN_PROFILE_VERSION',
      'OpenCovenDiagnosticError',
      'OpenCovenProfileError',
      'OperationAbortedError',
      'OperationConfigurationError',
      'OperationTimeoutError',
      'SecretStoreDisposedError',
      'assessCompatibility',
      'createFileOpenCovenProfileStore',
      'createManagedMemorySecretStore',
      'createMemoryOpenCovenProfileStore',
      'createMemorySecretStore',
      'createOpenCovenDiagnosticReport',
      'createOpenCovenProfileSecretReference',
      'createOperationScope',
      'createSecretStoreReference',
      'isOperationAbortedError',
      'isOperationTimeoutError',
      'iteratePages',
      'migrateOpenCovenProfileDocument',
      'normalizeError',
      'normalizePageOptions',
      'parseDiscoveryEndpoint',
      'parseDiscoveryRecord',
      'parseOpenCovenProfile',
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
      'canonicalFamiliarAnalyticsData',
      'canonicalFamiliarContractData',
      'createCaveClient',
      'createDiscoveredCaveClient',
      'createManagedCaveClient',
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
    expect(client.listFamiliars.bind(client)).toBeTypeOf('function');
    expect(client.listProjects.bind(client)).toBeTypeOf('function');
    expect(client.listConversations.bind(client)).toBeTypeOf('function');
    expect(client.getConversation.bind(client)).toBeTypeOf('function');
    expect(client.listConversationMessages.bind(client)).toBeTypeOf('function');
    expect(client.iterateFamiliars.bind(client)).toBeTypeOf('function');
    expect(client.iterateProjects.bind(client)).toBeTypeOf('function');
    expect(client.iterateConversations.bind(client)).toBeTypeOf('function');
    expect(
      client.iterateConversationMessages.bind(client),
    ).toBeTypeOf('function');
    expect(
      (client as unknown as Record<string, unknown>).iterateConversation,
    ).toBeUndefined();
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
