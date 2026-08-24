import {
  assessCompatibility,
  normalizePageOptions,
  type Page,
  type PageCursor,
} from '@opencoven/sdk-core';

import type {
  CaveCanonicalFamiliar,
  CaveConversation,
  CaveConversationMessage,
  CaveProject,
} from './schemas.js';
import { CAVE_CLIENT_VERSION } from './version.js';

const CAVE_API_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SUPPORTED_CAVE_API_MAJOR = '1';
const DECLARATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const DECLARATION_ID_MAX_CHARACTERS = 64;

type JsonObject = Record<string, unknown>;

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

function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  return value === undefined ? undefined : canonicalString(value, field);
}

function canonicalNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new CaveCanonicalSchemaError(field);
  }

  return value;
}

function optionalNumber(
  value: unknown,
  field: string,
): number | undefined {
  return value === undefined ? undefined : canonicalNumber(value, field);
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

function parseCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new CaveCanonicalSchemaError('capabilities');
  }

  const capabilities: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      throw new CaveCanonicalSchemaError(`capabilities[${index}]`);
    }
    if (
      entry.length > DECLARATION_ID_MAX_CHARACTERS ||
      !DECLARATION_ID_PATTERN.test(entry) ||
      capabilities.includes(entry)
    ) {
      throw new CaveCanonicalSchemaError(`capabilities[${index}]`);
    }
    capabilities.push(entry);
  }

  return capabilities;
}

function parseErrorDetails(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const details = canonicalObject(value, 'error.details');
  return Object.fromEntries(
    Object.entries(details).map(([key, entry]) => [
      key,
      canonicalString(entry, `error.details.${key}`),
    ]),
  );
}

function parseEnvelope(value: unknown): JsonObject {
  const envelope = canonicalObject(value, 'response');
  const apiVersion = canonicalString(envelope.apiVersion, 'apiVersion');
  const minimumClientVersion = canonicalString(
    envelope.minimumClientVersion,
    'minimumClientVersion',
  );
  parseCapabilities(envelope.capabilities);

  if (!CAVE_API_VERSION_PATTERN.test(apiVersion)) {
    throw new CaveCanonicalSchemaError('apiVersion');
  }
  if (apiVersion.split('.')[0] !== SUPPORTED_CAVE_API_MAJOR) {
    throw new CaveCanonicalResponseError(
      'incompatible_version',
      'Cave apiVersion was not compatible.',
    );
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
      : canonicalString(envelope.requestId, 'requestId');
  if (envelope.error !== undefined) {
    const error = canonicalObject(envelope.error, 'error');
    const details = parseErrorDetails(error.details);
    throw new CaveCanonicalResponseError(
      canonicalString(error.code, 'error.code'),
      canonicalString(error.message, 'error.message'),
      {
        retryable: canonicalBoolean(error.retryable, 'error.retryable'),
        ...(details === undefined ? {} : { details }),
        ...(requestId === undefined ? {} : { requestId }),
      },
    );
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
): Page<T> {
  const envelope = parseEnvelope(value);
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
  const activeSessions = optionalNumber(
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
  const exitCode = optionalNumber(conversation.exitCode, `${field}.exitCode`);
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
    attachmentCount: canonicalNumber(
      message.attachmentCount,
      `${field}.attachmentCount`,
    ),
    toolCount: canonicalNumber(message.toolCount, `${field}.toolCount`),
    ...(isError === undefined ? {} : { isError }),
    ...(cancelled === undefined ? {} : { cancelled }),
  };
}

export function parseFamiliarsEnvelope(
  value: unknown,
): Page<CaveCanonicalFamiliar> {
  return parsePage(value, 'familiars', parseFamiliar);
}

export function parseProjectsEnvelope(value: unknown): Page<CaveProject> {
  return parsePage(value, 'projects', parseProject);
}

export function parseConversationsEnvelope(
  value: unknown,
): Page<CaveConversation> {
  return parsePage(value, 'conversations', parseConversation);
}

export function parseConversationEnvelope(
  value: unknown,
): CaveConversation {
  const envelope = parseEnvelope(value);
  parseCursor(envelope.cursor);
  const data = canonicalObject(envelope.data, 'data');
  return parseConversation(data.conversation, 'data.conversation');
}

export function parseConversationMessagesEnvelope(
  value: unknown,
): Page<CaveConversationMessage> {
  return parsePage(value, 'messages', parseMessage);
}
