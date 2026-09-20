import {
  captureManagedHpkeDiscovery,
  createManagedHpkeAuthorityResolver,
  requireManagedHpkeAuthentication,
  type CaveManagedHpkeDiscovery,
  type CaveManagedHpkeAuthentication,
} from './managed-hpke.js';
import type { CaveManagedDiscoveredEndpoint } from './managed-discovery.js';
import { snapshotManagedResult } from './managed-snapshot.js';
import type {
  OperationContext,
  OperationDefaults,
  PageOptions,
} from '@opencoven/sdk-core';

import { parseCaveAuthorityBinding } from './authority-binding.js';
import {
  CAVE_CANONICAL_CONVERSATION_REQUIREMENTS,
  CAVE_CANONICAL_CONVERSATIONS_REQUIREMENTS,
  CAVE_CANONICAL_FAMILIARS_REQUIREMENTS,
  CAVE_CANONICAL_MESSAGES_REQUIREMENTS,
  CAVE_CANONICAL_PROJECTS_REQUIREMENTS,
  type CaveCanonicalEnvelopeRequirements,
} from './canonical-reads.js';
import { createCaveClient, type CaveClient } from './client.js';
import {
  parseCredentialMetadata,
  parseEnvelopeBase,
  parseErrorPayload,
  parseFamiliarsResponse,
  parsePairingStatus,
} from './pairing.js';
import type {
  CaveHealthResponse,
  CavePairingRequest,
} from './schemas.js';
import type {
  CaveStagedManagedCredentialState,
  CaveStagedManagedCredentialTransport,
} from './transport.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HANDLE_MAX_CHARACTERS = 512;
const MANAGED_PAYLOAD_MAX_NODES = 4_096;
const MANAGED_PAYLOAD_MAX_STRING_CHARACTERS = 64 * 1024;
const SECRET_FIELD_RE = /(?:bearer|secret)/iu;

export interface CaveManagedNativeResponse {
  statusCode: number;
  payload: unknown;
}

export interface CaveManagedNativeAuthenticatedResponse extends CaveManagedNativeResponse {
  authentication: CaveManagedHpkeAuthentication;
}

export interface CaveManagedNativePairingCreated {
  handle: string;
  response: CaveManagedNativeResponse;
}

export interface CaveManagedNativePairingExchange {
  authorityBinding: unknown;
  commitHandle: string;
  response: CaveManagedNativeResponse;
}

export type CaveManagedNativeDiscardResult =
  | 'absent'
  | 'changed'
  | 'deleted';

export interface CaveManagedNativeTransport {
  /** Native-owned authenticated reads: one HPKE request per invocation, without retry. */
  familiarsHpke?(discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
  listFamiliarsHpke?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
  listProjectsHpke?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
  listConversationsHpke?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
  getConversationHpke?(conversationId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
  listConversationMessagesHpke?(conversationId: string, options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;

  health(context?: OperationContext): Promise<CaveManagedNativeResponse>;
  pairingCreate(
    request: CavePairingRequest,
    context?: OperationContext,
  ): Promise<CaveManagedNativePairingCreated>;
  pairingPoll(
    handle: string,
    context?: OperationContext,
  ): Promise<CaveManagedNativeResponse>;
  pairingExchange(
    handle: string,
    context?: OperationContext,
  ): Promise<CaveManagedNativePairingExchange>;
  pairingCommit(
    commitHandle: string,
    context?: OperationContext,
  ): Promise<void>;
  pairingDiscard(
    commitHandle: string,
  ): Promise<CaveManagedNativeDiscardResult>;
  credentialState(context?: OperationContext): Promise<unknown>;
  forgetCredential(context?: OperationContext): Promise<unknown>;
  familiars(context?: OperationContext): Promise<CaveManagedNativeResponse>;
  listFamiliars(
    options: PageOptions,
    context?: OperationContext,
  ): Promise<CaveManagedNativeResponse>;
  listProjects(
    options: PageOptions,
    context?: OperationContext,
  ): Promise<CaveManagedNativeResponse>;
  listConversations(
    options: PageOptions,
    context?: OperationContext,
  ): Promise<CaveManagedNativeResponse>;
  getConversation(
    conversationId: string,
    context?: OperationContext,
  ): Promise<CaveManagedNativeResponse>;
  listConversationMessages(
    conversationId: string,
    options: PageOptions,
    context?: OperationContext,
  ): Promise<CaveManagedNativeResponse>;
}

export interface CaveManagedClientOptions {
  transport: CaveManagedNativeTransport;
  discovery?: CaveManagedHpkeDiscovery;
  operation?: OperationDefaults;
}

function managedError(
  code: string,
  message: string,
  options: {
    details?: Record<string, string>;
    retryable?: boolean;
    statusCode?: number;
  } = {},
): Error {
  return Object.assign(new Error(message), {
    code,
    retryable: options.retryable ?? false,
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.statusCode === undefined
      ? {}
      : { statusCode: options.statusCode }),
  });
}

function invalidResponse(message: string): Error {
  return managedError('invalid_response', message);
}

function unsupported(operation: string): Error {
  return managedError(
    'unsupported_operation',
    `Managed native Cave ${operation} was not configured.`,
  );
}

function nativeFailure(operation: string): Error {
  return managedError(
    'service_unavailable',
    `Managed native Cave ${operation} failed.`,
    { retryable: true },
  );
}

function ownDataObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw invalidResponse(`${label} was malformed.`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== 'string' ||
        descriptors[key] === undefined ||
        !Object.hasOwn(descriptors[key], 'value'),
    )
  ) {
    throw invalidResponse(`${label} was malformed.`);
  }

  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [
      key,
      descriptor.value,
    ]),
  );
}

function assertManagedJsonValue(value: unknown): void {
  const stack: unknown[] = [value];
  const seen = new Set<object>();
  let nodes = 0;
  let stringCharacters = 0;

  while (stack.length > 0) {
    const candidate = stack.pop();
    nodes += 1;
    if (nodes > MANAGED_PAYLOAD_MAX_NODES) {
      throw invalidResponse('Managed native Cave payload was too complex.');
    }

    if (
      candidate === null ||
      typeof candidate === 'boolean' ||
      typeof candidate === 'number'
    ) {
      if (
        typeof candidate === 'number' &&
        !Number.isFinite(candidate)
      ) {
        throw invalidResponse('Managed native Cave payload was not JSON-safe.');
      }
      continue;
    }
    if (typeof candidate === 'string') {
      stringCharacters += candidate.length;
      if (stringCharacters > MANAGED_PAYLOAD_MAX_STRING_CHARACTERS) {
        throw invalidResponse('Managed native Cave payload exceeded its limit.');
      }
      continue;
    }
    if (typeof candidate !== 'object' || candidate === undefined) {
      throw invalidResponse('Managed native Cave payload was not JSON-safe.');
    }
    if (seen.has(candidate)) {
      throw invalidResponse('Managed native Cave payload was cyclic.');
    }
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      if (candidate.length > MANAGED_PAYLOAD_MAX_NODES) {
        throw invalidResponse('Managed native Cave payload was too complex.');
      }
      const descriptors = Object.getOwnPropertyDescriptors(candidate);
      const expectedKeys = new Set([
        'length',
        ...Array.from({ length: candidate.length }, (_, index) =>
          String(index),
        ),
      ]);
      if (
        Reflect.ownKeys(candidate).some(
          (key) =>
            typeof key !== 'string' ||
            !expectedKeys.has(key) ||
            descriptors[key] === undefined ||
            !Object.hasOwn(descriptors[key], 'value'),
        )
      ) {
        throw invalidResponse(
          'Managed native Cave payload array was malformed.',
        );
      }
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, 'value')
        ) {
          throw invalidResponse(
            'Managed native Cave payload array was malformed.',
          );
        }
        stack.push(descriptor.value);
      }
      continue;
    }

    const object = ownDataObject(candidate, 'Managed native Cave payload');
    for (const [key, entry] of Object.entries(object)) {
      if (SECRET_FIELD_RE.test(key)) {
        throw invalidResponse(
          'Managed native Cave payload contained a secret-bearing field.',
        );
      }
      stringCharacters += key.length;
      stack.push(entry);
    }
  }
}

function validateHandle(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > HANDLE_MAX_CHARACTERS ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      );
    })
  ) {
    throw invalidResponse(`${label} was malformed.`);
  }
  return value;
}

function parseResponse(
  value: unknown,
  canonicalRequirements?: CaveCanonicalEnvelopeRequirements,
): unknown {
  const response = ownDataObject(value, 'Managed native Cave response');
  expectExactKeys(
    response,
    ['statusCode', 'payload'],
    'Managed native Cave response',
  );
  const statusCode = response.statusCode;
  if (
    !Number.isSafeInteger(statusCode) ||
    typeof statusCode !== 'number' ||
    statusCode < 100 ||
    statusCode > 599
  ) {
    throw invalidResponse('Managed native Cave statusCode was malformed.');
  }
  assertManagedJsonValue(response.payload);
  if (statusCode < 200 || statusCode >= 300) {
    throw parseErrorPayload(
      statusCode,
      response.payload,
      canonicalRequirements,
    );
  }
  return response.payload;
}

function expectExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expected.includes(key))
  ) {
    throw invalidResponse(`${label} contained unexpected fields.`);
  }
}

function parseManagedPairingCreated(
  value: unknown,
): {
  requestId: string;
  handle: string;
  expiresAt: number;
} {
  const created = ownDataObject(value, 'Managed pairing creation');
  expectExactKeys(created, ['handle', 'response'], 'Managed pairing creation');
  const handle = validateHandle(created.handle, 'Managed pairing handle');
  const envelope = ownDataObject(
    parseResponse(created.response),
    'Managed pairing response',
  );
  parseEnvelopeBase(envelope);
  const data = ownDataObject(
    envelope.data,
    'Managed pairing response data',
  );
  expectExactKeys(
    data,
    ['requestId', 'expiresAt'],
    'Managed pairing response data',
  );
  if (
    typeof data.requestId !== 'string' ||
    !UUID_RE.test(data.requestId) ||
    typeof data.expiresAt !== 'number' ||
    !Number.isSafeInteger(data.expiresAt) ||
    data.expiresAt < 0
  ) {
    throw invalidResponse('Managed pairing response was malformed.');
  }

  return {
    requestId: data.requestId,
    handle,
    expiresAt: data.expiresAt,
  };
}

function parseManagedAuthorityBinding(
  value: unknown,
): NonNullable<ReturnType<typeof parseCaveAuthorityBinding>> {
  assertManagedJsonValue(value);
  const binding = ownDataObject(value, 'Managed pairing authority binding');
  expectExactKeys(
    binding,
    ['version', 'instanceId', 'endpoint', 'record', 'freshness'],
    'Managed pairing authority binding',
  );
  expectExactKeys(
    ownDataObject(binding.endpoint, 'Managed authority endpoint'),
    ['kind', 'url'],
    'Managed authority endpoint',
  );
  expectExactKeys(
    ownDataObject(binding.record, 'Managed authority record'),
    ['identity', 'device', 'inode'],
    'Managed authority record',
  );
  expectExactKeys(
    ownDataObject(binding.freshness, 'Managed authority freshness'),
    ['pid', 'nonce', 'startedAt'],
    'Managed authority freshness',
  );
  const parsed = parseCaveAuthorityBinding(binding);
  if (parsed === undefined) {
    throw invalidResponse('Managed pairing authority binding was malformed.');
  }
  return parsed;
}

function parseManagedPairingExchange(
  value: unknown,
): {
  authorityBinding: NonNullable<
    ReturnType<typeof parseCaveAuthorityBinding>
  >;
  commitHandle: string;
  credential: ReturnType<typeof parseCredentialMetadata>;
} {
  const exchanged = ownDataObject(value, 'Managed pairing exchange');
  expectExactKeys(
    exchanged,
    ['authorityBinding', 'commitHandle', 'response'],
    'Managed pairing exchange',
  );
  const commitHandle = validateHandle(
    exchanged.commitHandle,
    'Managed credential commit handle',
  );
  const envelope = ownDataObject(
    parseResponse(exchanged.response),
    'Managed pairing exchange response',
  );
  parseEnvelopeBase(envelope);
  const data = ownDataObject(
    envelope.data,
    'Managed pairing exchange data',
  );
  expectExactKeys(
    data,
    ['credential'],
    'Managed pairing exchange data',
  );
  return {
    authorityBinding: parseManagedAuthorityBinding(
      exchanged.authorityBinding,
    ),
    commitHandle,
    credential: parseCredentialMetadata(data.credential),
  };
}

function parseCredentialState(value: unknown): CaveStagedManagedCredentialState {
  const state = ownDataObject(value, 'Managed credential state');
  expectExactKeys(state, ['status'], 'Managed credential state');
  if (
    state.status !== 'missing' &&
    state.status !== 'present' &&
    state.status !== 'update_in_progress' &&
    state.status !== 'invalid'
  ) {
    throw invalidResponse('Managed credential state was malformed.');
  }
  return state.status;
}

async function invokeNative<T>(
  native: CaveManagedNativeTransport,
  methodName: keyof CaveManagedNativeTransport,
  arguments_: readonly unknown[],
  operation: string,
  beforeInvoke?: () => void,
): Promise<T> {
  let method: unknown;
  try {
    method = Reflect.get(native, methodName);
  } catch {
    throw nativeFailure(operation);
  }
  if (typeof method !== 'function') {
    throw unsupported(operation);
  }
  beforeInvoke?.();
  try {
    return await Promise.resolve(
      Reflect.apply(method, native, arguments_) as T | PromiseLike<T>,
    );
  } catch {
    throw nativeFailure(operation);
  }
}

export function createManagedCaveClient(
  options: CaveManagedClientOptions,
): CaveClient {
  let discovery: CaveManagedHpkeDiscovery | undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(options, 'discovery');
    if (descriptor !== undefined && !Object.hasOwn(descriptor, 'value')) throw new TypeError();
    discovery = captureManagedHpkeDiscovery(descriptor?.value);
  } catch {
    throw new TypeError('Managed Cave discovery options must use own data properties.');
  }
  const native = options.transport;
  const resolver = createManagedHpkeAuthorityResolver(discovery);
  const read = (name: keyof CaveManagedNativeTransport, hpke: keyof CaveManagedNativeTransport,
    args: unknown[], context: OperationContext | undefined,
    requirements?: CaveCanonicalEnvelopeRequirements): Promise<unknown> => resolver.run(String(name), context, async (context) => {
    const authority = await resolver.resolve(context);
    const guard = () => resolver.beforeDispatch(authority, context);
    guard();
    if (authority?.version !== 2) {
      return parseResponse(await invokeNative(native, name, [...args, context], String(name), guard), requirements);
    }
    const response = ownDataObject(snapshotManagedResult(await invokeNative(native, hpke, [...args, authority, context], String(name), guard)),
      'Managed native Cave authenticated response');
    expectExactKeys(response, ['authentication', 'statusCode', 'payload'], 'Managed native Cave authenticated response');
    requireManagedHpkeAuthentication(response.authentication, authority);
    return parseResponse({ statusCode: response.statusCode, payload: response.payload }, requirements);
  });
  const transport: CaveStagedManagedCredentialTransport = {
    credentialMode: 'managed-native',
    async health(context) {
      return parseResponse(
        await invokeNative(native, 'health', [context], 'health'),
      ) as CaveHealthResponse;
    },
    async pairingCreateManaged(request, context) {
      return parseManagedPairingCreated(
        await invokeNative(
          native,
          'pairingCreate',
          [request, context],
          'pairingCreate',
        ),
      );
    },
    async pairingPollManaged(handle, context) {
      return parsePairingStatus(
        parseResponse(
          await invokeNative(
            native,
            'pairingPoll',
            [handle, context],
            'pairingPoll',
          ),
        ),
      );
    },
    async pairingExchangeManaged(handle, context) {
      let raw: unknown;
      try {
        raw = await invokeNative(
          native,
          'pairingExchange',
          [handle, context],
          'pairingExchange',
        );
        return parseManagedPairingExchange(raw);
      } catch (error) {
        if (raw !== undefined) {
          try {
            const exchange = ownDataObject(
              raw,
              'Managed pairing exchange',
            );
            const commitHandle = validateHandle(
              exchange.commitHandle,
              'Managed credential commit handle',
            );
            void invokeNative(
              native,
              'pairingDiscard',
              [commitHandle],
              'pairingDiscard',
            )
              .catch(() => undefined);
          } catch {
            // Nothing safe to discard.
          }
        }
        throw error;
      }
    },
    async pairingCommitManaged(commitHandle, context) {
      await invokeNative(
        native,
        'pairingCommit',
        [commitHandle, context],
        'pairingCommit',
      );
    },
    async pairingDiscardManaged(commitHandle) {
      const result = await invokeNative(
        native,
        'pairingDiscard',
        [commitHandle],
        'pairingDiscard',
      );
      if (
        result !== 'absent' &&
        result !== 'changed' &&
        result !== 'deleted'
      ) {
        throw invalidResponse(
          'Managed credential discard result was malformed.',
        );
      }
    },
    async credentialStateManaged(context) {
      return parseCredentialState(
        await invokeNative(
          native,
          'credentialState',
          [context],
          'credentialStatus',
        ),
      );
    },
    async forgetCredentialManaged(context) {
      const result = await invokeNative(
        native,
        'forgetCredential',
        [context],
        'forgetCredential',
      );
      if (typeof result !== 'boolean') {
        throw invalidResponse(
          'Managed credential forget result was malformed.',
        );
      }
      return result;
    },
    async familiars(context) {
      return parseFamiliarsResponse(await read('familiars', 'familiarsHpke', [], context));
    },
    listFamiliars: (options, context) => read('listFamiliars', 'listFamiliarsHpke', [options], context, CAVE_CANONICAL_FAMILIARS_REQUIREMENTS),
    listProjects: (options, context) => read('listProjects', 'listProjectsHpke', [options], context, CAVE_CANONICAL_PROJECTS_REQUIREMENTS),
    listConversations: (options, context) => read('listConversations', 'listConversationsHpke', [options], context, CAVE_CANONICAL_CONVERSATIONS_REQUIREMENTS),
    getConversation: (id, context) => read('getConversation', 'getConversationHpke', [id], context, CAVE_CANONICAL_CONVERSATION_REQUIREMENTS),
    listConversationMessages: (id, options, context) => read('listConversationMessages', 'listConversationMessagesHpke', [id, options], context, CAVE_CANONICAL_MESSAGES_REQUIREMENTS),
  };

  return createCaveClient({
    ...(options.operation === undefined
      ? {}
      : { operation: options.operation }),
    transport,
  });
}
