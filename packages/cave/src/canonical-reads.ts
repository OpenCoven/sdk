import {
  assessCompatibility,
  normalizePageOptions,
  type Page,
  type PageCursor,
  type PageOptions,
} from '@opencoven/sdk-core/browser';

import type {
  CaveCanonicalFamiliar,
  CaveConversation,
  CaveConversationMessage,
  CaveProject,
} from './schemas.js';
import {
  CAVE_CONTRACT_API_VERSION,
  CAVE_CONTRACT_LIMITS,
  isCaveContractErrorCode,
} from './contract-constraints.js';
import { CAVE_CLIENT_VERSION } from './version.js';

const DECLARATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const CANONICAL_FAMILIARS_PATH = '/api/client/v1/familiars';
const CANONICAL_PROJECTS_PATH = '/api/client/v1/projects';
const CANONICAL_CONVERSATIONS_PATH = '/api/client/v1/conversations';

type JsonObject = Record<string, unknown>;

export interface CaveCanonicalEnvelopeRequirements {
  operation: string;
  capabilities: readonly string[];
}

export const CAVE_CANONICAL_FAMILIARS_REQUIREMENTS = {
  operation: 'familiars.list',
  capabilities: ['familiars', 'cursors'],
} as const satisfies CaveCanonicalEnvelopeRequirements;

export const CAVE_CANONICAL_PROJECTS_REQUIREMENTS = {
  operation: 'projects.list',
  capabilities: ['projects', 'cursors'],
} as const satisfies CaveCanonicalEnvelopeRequirements;

export const CAVE_CANONICAL_CONVERSATIONS_REQUIREMENTS = {
  operation: 'conversations.list',
  capabilities: ['conversations', 'cursors'],
} as const satisfies CaveCanonicalEnvelopeRequirements;

export const CAVE_CANONICAL_CONVERSATION_REQUIREMENTS = {
  operation: 'conversations.read',
  capabilities: ['conversations'],
} as const satisfies CaveCanonicalEnvelopeRequirements;

export const CAVE_CANONICAL_MESSAGES_REQUIREMENTS = {
  operation: 'messages.list',
  capabilities: ['conversation-messages', 'cursors'],
} as const satisfies CaveCanonicalEnvelopeRequirements;

function canonicalPageQuery(options: PageOptions): string {
  const normalized = normalizePageOptions(options);
  const query = new URLSearchParams();
  query.append('limit', String(normalized.limit));
  if (normalized.cursor !== undefined) {
    query.append('cursor', normalized.cursor);
  }

  return query.toString();
}

function canonicalListRoute(
  path:
    | typeof CANONICAL_FAMILIARS_PATH
    | typeof CANONICAL_PROJECTS_PATH
    | typeof CANONICAL_CONVERSATIONS_PATH,
  options: PageOptions,
): string {
  return `${path}?${canonicalPageQuery(options)}`;
}

function encodedConversationPath(conversationId: string): string {
  return `${CANONICAL_CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}`;
}

export function canonicalFamiliarsRoute(options: PageOptions): string {
  return canonicalListRoute(CANONICAL_FAMILIARS_PATH, options);
}

export function canonicalProjectsRoute(options: PageOptions): string {
  return canonicalListRoute(CANONICAL_PROJECTS_PATH, options);
}

export function canonicalConversationsRoute(options: PageOptions): string {
  return canonicalListRoute(CANONICAL_CONVERSATIONS_PATH, options);
}

export function canonicalConversationRoute(conversationId: string): string {
  return encodedConversationPath(conversationId);
}

export function canonicalConversationMessagesRoute(
  conversationId: string,
  options: PageOptions,
): string {
  return `${encodedConversationPath(conversationId)}/messages?${canonicalPageQuery(options)}`;
}

export class CaveCanonicalSchemaError extends TypeError {
  readonly field: string;

  constructor(field: string) {
    super(`${field} was malformed.`);
    this.name = 'CaveCanonicalSchemaError';
    this.field = field;
  }
}

class CaveCanonicalResponseError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, string> | undefined;
  readonly requestId: string | undefined;

  constructor(
    code: string,
    message: string,
    options: {
      details?: Record<string, string>;
      requestId?: string;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'CaveCanonicalResponseError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

function canonicalObject(value: unknown, field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CaveCanonicalSchemaError(field);
  }

  return value as JsonObject;
}

function canonicalString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new CaveCanonicalSchemaError(field);
  }

  return value;
}

function canonicalBoundedString(
  value: unknown,
  field: string,
  maximumLength: number,
  options: { requireNonEmpty?: boolean } = {},
): string {
  const parsed = canonicalString(value, field);
  if (
    parsed.length > maximumLength ||
    (options.requireNonEmpty === true && parsed.length === 0)
  ) {
    throw new CaveCanonicalSchemaError(field);
  }

  return parsed;
}

function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  return value === undefined ? undefined : canonicalString(value, field);
}

function canonicalSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new CaveCanonicalSchemaError(field);
  }

  return value as number;
}

function optionalNullableSafeInteger(
  value: unknown,
  field: string,
): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  return canonicalSafeInteger(value, field);
}

function canonicalCount(value: unknown, field: string): number {
  const count = canonicalSafeInteger(value, field);
  if (count < 0) {
    throw new CaveCanonicalSchemaError(field);
  }

  return count;
}

function optionalCount(
  value: unknown,
  field: string,
): number | undefined {
  return value === undefined ? undefined : canonicalCount(value, field);
}

function canonicalBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new CaveCanonicalSchemaError(field);
  }

  return value;
}

function optionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  return value === undefined ? undefined : canonicalBoolean(value, field);
}

function parseDeclarationIds(
  value: unknown,
  field: string,
  options: { requireNonEmpty?: boolean } = {},
): string[] {
  if (!Array.isArray(value)) {
    throw new CaveCanonicalSchemaError(field);
  }
  if (options.requireNonEmpty === true && value.length === 0) {
    throw new CaveCanonicalSchemaError(field);
  }

  const declarations: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      throw new CaveCanonicalSchemaError(`${field}[${index}]`);
    }
    if (
      entry.length > CAVE_CONTRACT_LIMITS.declarationIdCharacters ||
      !DECLARATION_ID_PATTERN.test(entry) ||
      declarations.includes(entry)
    ) {
      throw new CaveCanonicalSchemaError(`${field}[${index}]`);
    }
    declarations.push(entry);
  }

  return declarations;
}

function parseErrorDetails(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const details = canonicalObject(value, 'error.details');
  const entries = Object.entries(details);
  if (entries.length > CAVE_CONTRACT_LIMITS.errorDetailEntries) {
    throw new CaveCanonicalSchemaError('error.details');
  }

  return Object.fromEntries(
    entries.map(([key, entry]) => [
      key,
      canonicalBoundedString(
        entry,
        `error.details.${key}`,
        CAVE_CONTRACT_LIMITS.errorDetailValueCharacters,
      ),
    ]),
  );
}

function parseEnvelope(
  value: unknown,
  requirements: CaveCanonicalEnvelopeRequirements,
): JsonObject {
  const envelope = canonicalObject(value, 'response');
  const apiVersion = canonicalString(envelope.apiVersion, 'apiVersion');
  const minimumClientVersion = canonicalString(
    envelope.minimumClientVersion,
    'minimumClientVersion',
  );
  const capabilities = parseDeclarationIds(envelope.capabilities, 'capabilities', {
    requireNonEmpty: true,
  });
  const operations = parseDeclarationIds(envelope.operations, 'operations', {
    requireNonEmpty: true,
  });

  if (apiVersion !== CAVE_CONTRACT_API_VERSION) {
    throw new CaveCanonicalSchemaError('apiVersion');
  }
  if (!operations.includes(requirements.operation)) {
    throw new CaveCanonicalSchemaError('operations');
  }
  if (
    requirements.capabilities.some(
      (capability) => !capabilities.includes(capability),
    )
  ) {
    throw new CaveCanonicalSchemaError('capabilities');
  }

  let compatibility: ReturnType<typeof assessCompatibility>;
  try {
    compatibility = assessCompatibility(
      minimumClientVersion,
      CAVE_CLIENT_VERSION,
    );
  } catch {
    throw new CaveCanonicalSchemaError('minimumClientVersion');
  }
  if (!compatibility.compatible) {
    throw new CaveCanonicalResponseError(
      'incompatible_version',
      'Cave minimumClientVersion was not compatible.',
    );
  }

  const requestId =
    envelope.requestId === undefined
      ? undefined
      : canonicalBoundedString(
          envelope.requestId,
          'requestId',
          CAVE_CONTRACT_LIMITS.requestIdCharacters,
          { requireNonEmpty: true },
        );
  const hasData = envelope.data !== undefined;
  const hasError = envelope.error !== undefined;
  if (hasData && hasError) {
    throw new CaveCanonicalSchemaError('response');
  }

  if (hasError) {
    const error = canonicalObject(envelope.error, 'error');
    const code = canonicalString(error.code, 'error.code');
    if (!isCaveContractErrorCode(code)) {
      throw new CaveCanonicalSchemaError('error.code');
    }
    const message = canonicalBoundedString(
      error.message,
      'error.message',
      CAVE_CONTRACT_LIMITS.errorMessageCharacters,
      { requireNonEmpty: true },
    );
    const details = parseErrorDetails(error.details);
    throw new CaveCanonicalResponseError(
      code,
      message,
      {
        retryable: canonicalBoolean(error.retryable, 'error.retryable'),
        ...(details === undefined ? {} : { details }),
        ...(requestId === undefined ? {} : { requestId }),
      },
    );
  }

  if (!hasData) {
    throw new CaveCanonicalSchemaError('data');
  }
  canonicalObject(envelope.data, 'data');
  return envelope;
}

function parseCursor(value: unknown): PageCursor | undefined {
  if (value === undefined) {
    return undefined;
  }

  const cursor = canonicalObject(value, 'cursor');
  const parsed: PageCursor = {
    hasMore: canonicalBoolean(cursor.hasMore, 'cursor.hasMore'),
  };

  for (const key of ['current', 'next', 'previous'] as const) {
    const candidate = cursor[key];
    if (candidate === undefined) {
      continue;
    }
    if (typeof candidate !== 'string') {
      throw new CaveCanonicalSchemaError(`cursor.${key}`);
    }
    try {
      normalizePageOptions({ cursor: candidate });
    } catch {
      throw new CaveCanonicalSchemaError(`cursor.${key}`);
    }
    parsed[key] = candidate;
  }

  return parsed;
}

function parsePage<T>(
  value: unknown,
  collection: string,
  parseEntry: (entry: unknown, field: string) => T,
  requirements: CaveCanonicalEnvelopeRequirements,
): Page<T> {
  const envelope = parseEnvelope(value, requirements);
  const data = canonicalObject(envelope.data, 'data');
  const entries = data[collection];
  if (!Array.isArray(entries)) {
    throw new CaveCanonicalSchemaError(`data.${collection}`);
  }
  const cursor = parseCursor(envelope.cursor);

  return {
    data: entries.map((entry, index) =>
      parseEntry(entry, `data.${collection}[${index}]`),
    ),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function parseFamiliar(
  value: unknown,
  field: string,
): CaveCanonicalFamiliar {
  const familiar = canonicalObject(value, field);
  const description = optionalString(
    familiar.description,
    `${field}.description`,
  );
  const pronouns = optionalString(familiar.pronouns, `${field}.pronouns`);
  const status = optionalString(familiar.status, `${field}.status`);
  const lastSeenAt = optionalString(
    familiar.lastSeenAt,
    `${field}.lastSeenAt`,
  );
  const activeSessions = optionalCount(
    familiar.activeSessions,
    `${field}.activeSessions`,
  );

  return {
    id: canonicalString(familiar.id, `${field}.id`),
    displayName: canonicalString(
      familiar.displayName,
      `${field}.displayName`,
    ),
    role: canonicalString(familiar.role, `${field}.role`),
    ...(description === undefined ? {} : { description }),
    ...(pronouns === undefined ? {} : { pronouns }),
    ...(status === undefined ? {} : { status }),
    ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
    ...(activeSessions === undefined ? {} : { activeSessions }),
  };
}

function parseProject(value: unknown, field: string): CaveProject {
  const project = canonicalObject(value, field);
  const color = optionalString(project.color, `${field}.color`);
  const repoUrl = optionalString(project.repoUrl, `${field}.repoUrl`);

  return {
    id: canonicalString(project.id, `${field}.id`),
    name: canonicalString(project.name, `${field}.name`),
    root: canonicalString(project.root, `${field}.root`),
    ...(color === undefined ? {} : { color }),
    ...(repoUrl === undefined ? {} : { repoUrl }),
    createdAt: canonicalString(project.createdAt, `${field}.createdAt`),
    updatedAt: canonicalString(project.updatedAt, `${field}.updatedAt`),
  };
}

function parseConversation(
  value: unknown,
  field: string,
): CaveConversation {
  const conversation = canonicalObject(value, field);
  const harness = optionalString(conversation.harness, `${field}.harness`);
  const model = optionalString(conversation.model, `${field}.model`);
  const runtime = optionalString(conversation.runtime, `${field}.runtime`);
  const title = optionalString(conversation.title, `${field}.title`);
  const origin = optionalString(conversation.origin, `${field}.origin`);
  const status = optionalString(conversation.status, `${field}.status`);
  const exitCode = optionalNullableSafeInteger(
    conversation.exitCode,
    `${field}.exitCode`,
  );
  const pending = optionalBoolean(conversation.pending, `${field}.pending`);
  const createdAt = optionalString(
    conversation.createdAt,
    `${field}.createdAt`,
  );

  return {
    id: canonicalString(conversation.id, `${field}.id`),
    familiarId: canonicalString(
      conversation.familiarId,
      `${field}.familiarId`,
    ),
    ...(harness === undefined ? {} : { harness }),
    ...(model === undefined ? {} : { model }),
    ...(runtime === undefined ? {} : { runtime }),
    ...(title === undefined ? {} : { title }),
    ...(origin === undefined ? {} : { origin }),
    ...(status === undefined ? {} : { status }),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(pending === undefined ? {} : { pending }),
    ...(createdAt === undefined ? {} : { createdAt }),
    updatedAt: canonicalString(conversation.updatedAt, `${field}.updatedAt`),
  };
}

function parseMessage(
  value: unknown,
  field: string,
): CaveConversationMessage {
  const message = canonicalObject(value, field);
  const parentId =
    message.parentId === null
      ? null
      : canonicalString(message.parentId, `${field}.parentId`);
  const isError = optionalBoolean(message.isError, `${field}.isError`);
  const cancelled = optionalBoolean(message.cancelled, `${field}.cancelled`);

  return {
    id: canonicalString(message.id, `${field}.id`),
    conversationId: canonicalString(
      message.conversationId,
      `${field}.conversationId`,
    ),
    parentId,
    role: canonicalString(message.role, `${field}.role`),
    text: canonicalString(message.text, `${field}.text`),
    createdAt: canonicalString(message.createdAt, `${field}.createdAt`),
    attachmentCount: canonicalCount(
      message.attachmentCount,
      `${field}.attachmentCount`,
    ),
    toolCount: canonicalCount(message.toolCount, `${field}.toolCount`),
    ...(isError === undefined ? {} : { isError }),
    ...(cancelled === undefined ? {} : { cancelled }),
  };
}

export function parseFamiliarsEnvelope(
  value: unknown,
): Page<CaveCanonicalFamiliar> {
  return parsePage(
    value,
    'familiars',
    parseFamiliar,
    CAVE_CANONICAL_FAMILIARS_REQUIREMENTS,
  );
}

export function parseProjectsEnvelope(value: unknown): Page<CaveProject> {
  return parsePage(
    value,
    'projects',
    parseProject,
    CAVE_CANONICAL_PROJECTS_REQUIREMENTS,
  );
}

export function parseConversationsEnvelope(
  value: unknown,
): Page<CaveConversation> {
  return parsePage(
    value,
    'conversations',
    parseConversation,
    CAVE_CANONICAL_CONVERSATIONS_REQUIREMENTS,
  );
}

export function parseConversationEnvelope(
  value: unknown,
): CaveConversation {
  const envelope = parseEnvelope(
    value,
    CAVE_CANONICAL_CONVERSATION_REQUIREMENTS,
  );
  parseCursor(envelope.cursor);
  const data = canonicalObject(envelope.data, 'data');
  return parseConversation(data.conversation, 'data.conversation');
}

export function parseConversationMessagesEnvelope(
  value: unknown,
): Page<CaveConversationMessage> {
  return parsePage(
    value,
    'messages',
    parseMessage,
    CAVE_CANONICAL_MESSAGES_REQUIREMENTS,
  );
}
