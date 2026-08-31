import {
  assessCompatibility,
  OperationConfigurationError,
  type OperationObserver,
} from '@opencoven/sdk-core/browser';

import { parseConversation } from './canonical-reads.js';
import {
  CAVE_CONTRACT_API_VERSION,
  CAVE_CONTRACT_LIMITS,
  isCaveContractErrorCode,
} from './contract-constraints.js';
import type { CaveConversation } from './schemas.js';
import { CAVE_CLIENT_VERSION } from './version.js';

/**
 * Conversational control: the first bounded mutation authority.
 *
 * Cave remains the sole executor and canonical state owner. The SDK exposes
 * constrained typed operations only — never arbitrary HTTP paths, private
 * Cave routes, or raw transport escape hatches — and owns the public DTOs,
 * validators, and the single event translator shared by initial and resumed
 * streams.
 *
 * The five Client v1 operations this surface is defined against
 * (`conversations.create`, `messages.send`, `operations.read`,
 * `operations.events`, `operations.stop`) are not yet declared by the
 * authoritative Cave contract fixture this SDK vendors. This module therefore
 * defines the typed requests, results, operation records, event vocabulary,
 * cursor handling, and translation rules only; it introduces no HTTP paths.
 * Transport bindings for the five operations stay optional and are expected
 * to arrive with the upstream Cave producer contract and a re-imported
 * fixture.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */

export type CaveConversationOperationId = string;

export type CaveConversationEventCursor = string;

export interface CaveCreateConversationRequest {
  operationId: CaveConversationOperationId;
  familiarId: string;
  projectId?: string;
}

export type CaveSendConversationMessageRequest =
  | {
      operationId: CaveConversationOperationId;
      text: string;
      retryOfTurnId?: never;
    }
  | {
      operationId: CaveConversationOperationId;
      retryOfTurnId: string;
      text?: never;
    };

export interface CaveRetryConversationTurnRequest {
  operationId: CaveConversationOperationId;
  retryOfTurnId: string;
}

export type CaveConversationOperationState =
  | 'pending'
  | 'accepted'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CaveConversationOperationKind =
  | 'conversations.create'
  | 'messages.send';

export type CaveConversationOriginatingScope =
  | 'chat:write'
  | 'conversations:write';

export interface CaveConversationOperation {
  id: CaveConversationOperationId;
  kind: CaveConversationOperationKind;
  state: CaveConversationOperationState;
  originatingScope: CaveConversationOriginatingScope;
  conversationId: string;
  inputTurnId?: string;
  outputTurnId?: string;
  retryOfTurnId?: string;
  failureCode?: string;
  latestEventId: number;
  replayFloorEventId: number;
  createdAt: string;
  updatedAt: string;
  idempotencyResultExpiresAt?: string;
}

export interface CaveCreateConversationResult {
  operationId: CaveConversationOperationId;
  replayed: boolean;
  conversation: CaveConversation;
}

export interface CaveSendConversationMessageResult {
  operation: CaveConversationOperation;
  replayed: boolean;
}

export interface CaveConversationEventBase {
  operationId: CaveConversationOperationId;
  eventId: number;
  cursor: CaveConversationEventCursor;
  occurredAt: string;
}

export type CaveConversationEventType =
  | 'operation.accepted'
  | 'assistant.delta'
  | 'operation.stopping'
  | 'operation.completed'
  | 'operation.failed'
  | 'operation.cancelled';

export type CaveConversationEvent =
  | (CaveConversationEventBase & {
      type: 'operation.accepted';
      conversationId: string;
      inputTurnId: string;
      retryOfTurnId?: string;
    })
  | (CaveConversationEventBase & {
      type: 'assistant.delta';
      text: string;
    })
  | (CaveConversationEventBase & {
      type: 'operation.stopping';
    })
  | (CaveConversationEventBase & {
      type: 'operation.completed';
      outputTurnId: string;
    })
  | (CaveConversationEventBase & {
      type: 'operation.failed';
      outputTurnId: string;
      code: string;
    })
  | (CaveConversationEventBase & {
      type: 'operation.cancelled';
      outputTurnId: string;
    });

export interface CaveConversationEventPage {
  operation: CaveConversationOperation;
  events: readonly CaveConversationEvent[];
  complete: boolean;
  cursor?: {
    current?: CaveConversationEventCursor;
    next?: CaveConversationEventCursor;
    hasMore: boolean;
  };
}

export interface CaveConversationEventPageRequest {
  cursor?: CaveConversationEventCursor;
  waitMs?: number;
}

export interface CaveConversationStreamOptions {
  cursor?: CaveConversationEventCursor;
  signal?: AbortSignal;
  timeoutMs?: number;
  observer?: OperationObserver;
}

export const CAVE_CONVERSATION_OPERATION_STATES = [
  'pending',
  'accepted',
  'running',
  'stopping',
  'completed',
  'failed',
  'cancelled',
] as const;

export const CAVE_CONVERSATION_TERMINAL_STATES = [
  'completed',
  'failed',
  'cancelled',
] as const;

export const CAVE_CONVERSATION_EVENT_TYPES = [
  'operation.accepted',
  'assistant.delta',
  'operation.stopping',
  'operation.completed',
  'operation.failed',
  'operation.cancelled',
] as const;

/** The scope stored with an operation when it was claimed; reads of the operation and its events are authorized by it. */
export const CAVE_CONVERSATION_ORIGINATING_SCOPES = [
  'chat:write',
  'conversations:write',
] as const;

/**
 * The defined `reconcile_required` reasons. A `reconcile_required` error is
 * an instruction to reload canonical state, not a transient transport retry.
 */
export const CAVE_CONVERSATION_RECONCILE_REASONS = [
  'replay_gap',
  'operation_expired',
  'canonical_branch_changed',
  'idempotency_result_expired',
  'canonical_state_moved',
] as const;

export type CaveConversationReconcileReason =
  (typeof CAVE_CONVERSATION_RECONCILE_REASONS)[number];

export class CaveConversationSchemaError extends TypeError {
  readonly field: string;

  constructor(field: string) {
    super(`${field} was malformed.`);
    this.name = 'CaveConversationSchemaError';
    this.field = field;
  }
}

/**
 * A contract error envelope (`error` inside the shared Client v1 envelope).
 * `details` carries bounded string-valued route metadata only — for example
 * the `reconcile_required` reason.
 */
export class CaveConversationResponseError extends Error {
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
    this.name = 'CaveConversationResponseError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

type JsonObject = Record<string, unknown>;

const CONVERSATION_STATE_SET = new Set<string>(CAVE_CONVERSATION_OPERATION_STATES);
const CONVERSATION_TERMINAL_STATE_SET = new Set<string>(
  CAVE_CONVERSATION_TERMINAL_STATES,
);
const CONVERSATION_EVENT_TYPE_SET = new Set<string>(CAVE_CONVERSATION_EVENT_TYPES);

/**
 * The existing Client v1 UUID contract: exactly 36 characters and the
 * current RFC-compatible UUID pattern. Cave normalizes accepted UUIDs to
 * lowercase before key lookup, so case variants cannot claim two operations.
 */
const CONVERSATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const DECLARATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function conversationObject(value: unknown, field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CaveConversationSchemaError(field);
  }
  return value as JsonObject;
}

function conversationString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new CaveConversationSchemaError(field);
  }
  return value;
}

function conversationBoundedString(
  value: unknown,
  field: string,
  maximumLength: number,
  options: { requireNonEmpty?: boolean } = {},
): string {
  const parsed = conversationString(value, field);
  if (
    parsed.length > maximumLength ||
    (options.requireNonEmpty === true && parsed.length === 0)
  ) {
    throw new CaveConversationSchemaError(field);
  }
  return parsed;
}

function conversationBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new CaveConversationSchemaError(field);
  }
  return value;
}

function conversationCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CaveConversationSchemaError(field);
  }
  return value as number;
}

function conversationOptionalNonEmptyString(
  value: unknown,
  field: string,
): string | undefined {
  return value === undefined
    ? undefined
    : conversationBoundedString(
        value,
        field,
        CAVE_CONTRACT_LIMITS.errorMessageCharacters,
        { requireNonEmpty: true },
      );
}

function conversationExactKeys(
  value: JsonObject,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new CaveConversationSchemaError(`${field}.${key}`);
    }
  }
}

function conversationDeclarationIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CaveConversationSchemaError(field);
  }
  const declarations: string[] = [];
  for (const [index, entry] of value.entries()) {
    const declaration = conversationBoundedString(
      entry,
      `${field}[${index}]`,
      CAVE_CONTRACT_LIMITS.declarationIdCharacters,
      { requireNonEmpty: true },
    );
    if (!DECLARATION_ID_PATTERN.test(declaration) || declarations.includes(declaration)) {
      throw new CaveConversationSchemaError(`${field}[${index}]`);
    }
    declarations.push(declaration);
  }
  return declarations;
}

function requireOwnShape(
  value: unknown,
  label: string,
): { record: JsonObject; keys: Set<string> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationConfigurationError(`${label} must be an object`);
  }
  const record = value as JsonObject;
  return { record, keys: new Set(Object.keys(record)) };
}

function rejectUnknownRequestKeys(
  present: ReadonlySet<string>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of present) {
    if (!allowed.has(key)) {
      throw new OperationConfigurationError(`${label} has an unknown field`);
    }
  }
}

function requireRequestKeys(
  present: ReadonlySet<string>,
  required: readonly string[],
  label: string,
): void {
  for (const key of required) {
    if (!present.has(key)) {
      throw new OperationConfigurationError(`${label} requires ${key}`);
    }
  }
}

/**
 * The caller-supplied, caller-visible operation UUID. Exactly 36 characters,
 * RFC-compatible, normalized to lowercase so case variants cannot claim two
 * operations. The untrusted value is never echoed in the error.
 */
export function validateConversationOperationId(
  value: unknown,
): CaveConversationOperationId {
  if (
    typeof value !== 'string' ||
    value.length !== 36 ||
    !CONVERSATION_UUID_PATTERN.test(value)
  ) {
    throw new OperationConfigurationError(
      'operationId must be a 36-character UUID',
    );
  }
  return value.toLowerCase();
}

/**
 * Event cursors are opaque route strings bounded by the authoritative
 * `cursorCharacters` limit. The SDK never decodes them.
 */
export function validateConversationEventCursor(
  value: unknown,
  label: string,
): CaveConversationEventCursor {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OperationConfigurationError(`${label} must be a non-empty string`);
  }
  if (value.length > CAVE_CONTRACT_LIMITS.cursorCharacters) {
    throw new OperationConfigurationError(
      `${label} must be at most ${CAVE_CONTRACT_LIMITS.cursorCharacters} characters`,
    );
  }
  return value;
}

function validateConversationTargetId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OperationConfigurationError(`${label} must be a non-empty string`);
  }
  if (value === '.' || value === '..') {
    throw new OperationConfigurationError(
      `${label} must not be a dot path segment`,
    );
  }
  return value;
}

const CREATE_REQUEST_KEYS = new Set(['operationId', 'familiarId', 'projectId']);
const SEND_REQUEST_KEYS = new Set(['operationId', 'text', 'retryOfTurnId']);
const RETRY_REQUEST_KEYS = new Set(['operationId', 'retryOfTurnId']);

/**
 * Create accepts only the operation UUID, one canonical familiar ID, and an
 * optional canonical project ID. Cave resolves project roots, harnesses,
 * runtimes, titles, and origin internally: the caller cannot send a
 * filesystem path, harness command, runtime URL, model-provider payload,
 * origin marker, or prebuilt transcript.
 */
export function parseCreateConversationRequest(
  value: unknown,
): CaveCreateConversationRequest {
  const { record, keys } = requireOwnShape(value, 'createConversation request');
  rejectUnknownRequestKeys(keys, CREATE_REQUEST_KEYS, 'createConversation request');
  requireRequestKeys(keys, ['operationId', 'familiarId'], 'createConversation request');
  const operationId = validateConversationOperationId(record.operationId);
  const familiarId = validateConversationTargetId(record.familiarId, 'familiarId');
  const projectId =
    record.projectId === undefined
      ? undefined
      : validateConversationTargetId(record.projectId, 'projectId');

  return {
    operationId,
    familiarId,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

/**
 * A send request carries exactly one of `text` (a new send) or
 * `retryOfTurnId` (an explicit retry of a failed or cancelled assistant
 * turn). Text is preserved byte for byte: Cave does not Unicode-normalize or
 * trim persisted text, and the canonical request hash distinguishes
 * whitespace and normalization variants.
 */
export function parseSendConversationMessageRequest(
  value: unknown,
): CaveSendConversationMessageRequest {
  const { record, keys } = requireOwnShape(
    value,
    'sendConversationMessage request',
  );
  rejectUnknownRequestKeys(keys, SEND_REQUEST_KEYS, 'sendConversationMessage request');
  requireRequestKeys(keys, ['operationId'], 'sendConversationMessage request');
  const operationId = validateConversationOperationId(record.operationId);
  const hasText = record.text !== undefined;
  const hasRetry = record.retryOfTurnId !== undefined;

  if (hasText === hasRetry) {
    throw new OperationConfigurationError(
      'sendConversationMessage requires exactly one of text or retryOfTurnId',
    );
  }

  if (hasRetry) {
    const retryOfTurnId = validateConversationTargetId(
      record.retryOfTurnId,
      'retryOfTurnId',
    );
    return { operationId, retryOfTurnId };
  }

  const text = record.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new OperationConfigurationError(
      'sendConversationMessage text must be a non-empty string',
    );
  }
  return { operationId, text };
}

/**
 * Retry requires a fresh operation UUID and the canonical `retryOfTurnId`.
 * It carries no replacement text: the executor reads the exact canonical
 * parent user content from the transcript.
 */
export function parseRetryConversationTurnRequest(
  value: unknown,
): CaveRetryConversationTurnRequest {
  const { record, keys } = requireOwnShape(
    value,
    'retryConversationTurn request',
  );
  rejectUnknownRequestKeys(keys, RETRY_REQUEST_KEYS, 'retryConversationTurn request');
  requireRequestKeys(keys, ['operationId', 'retryOfTurnId'], 'retryConversationTurn request');
  const operationId = validateConversationOperationId(record.operationId);
  const retryOfTurnId = validateConversationTargetId(
    record.retryOfTurnId,
    'retryOfTurnId',
  );
  return { operationId, retryOfTurnId };
}

const OPERATION_DTO_KEYS = new Set([
  'id',
  'kind',
  'state',
  'originatingScope',
  'conversationId',
  'inputTurnId',
  'outputTurnId',
  'retryOfTurnId',
  'failureCode',
  'latestEventId',
  'replayFloorEventId',
  'createdAt',
  'updatedAt',
  'idempotencyResultExpiresAt',
]);

/**
 * The non-content operation record: fixed codes, turn references, event
 * bounds, and timestamps only. Prompt, attachment, bearer, pairing secret,
 * HPKE material, stack, cause, command output, or environment content never
 * appears here.
 */
export function parseConversationOperation(
  value: unknown,
  field: string,
): CaveConversationOperation {
  const operation = conversationObject(value, field);
  conversationExactKeys(operation, OPERATION_DTO_KEYS, field);

  const id = conversationString(operation.id, `${field}.id`);
  if (
    id.length !== 36 ||
    !CONVERSATION_UUID_PATTERN.test(id) ||
    id !== id.toLowerCase()
  ) {
    throw new CaveConversationSchemaError(`${field}.id`);
  }

  const kind = conversationString(operation.kind, `${field}.kind`);
  if (kind !== 'conversations.create' && kind !== 'messages.send') {
    throw new CaveConversationSchemaError(`${field}.kind`);
  }
  const state = conversationString(operation.state, `${field}.state`);
  if (!CONVERSATION_STATE_SET.has(state)) {
    throw new CaveConversationSchemaError(`${field}.state`);
  }
  const originatingScope = conversationString(
    operation.originatingScope,
    `${field}.originatingScope`,
  );
  if (originatingScope !== 'chat:write' && originatingScope !== 'conversations:write') {
    throw new CaveConversationSchemaError(`${field}.originatingScope`);
  }
  const conversationId = conversationBoundedString(
    operation.conversationId,
    `${field}.conversationId`,
    CAVE_CONTRACT_LIMITS.cursorCharacters,
    { requireNonEmpty: true },
  );
  const inputTurnId = conversationOptionalNonEmptyString(
    operation.inputTurnId,
    `${field}.inputTurnId`,
  );
  const outputTurnId = conversationOptionalNonEmptyString(
    operation.outputTurnId,
    `${field}.outputTurnId`,
  );
  const retryOfTurnId = conversationOptionalNonEmptyString(
    operation.retryOfTurnId,
    `${field}.retryOfTurnId`,
  );
  const failureCode = conversationOptionalNonEmptyString(
    operation.failureCode,
    `${field}.failureCode`,
  );
  const latestEventId = conversationCount(
    operation.latestEventId,
    `${field}.latestEventId`,
  );
  const replayFloorEventId = conversationCount(
    operation.replayFloorEventId,
    `${field}.replayFloorEventId`,
  );
  const createdAt = conversationBoundedString(
    operation.createdAt,
    `${field}.createdAt`,
    CAVE_CONTRACT_LIMITS.errorMessageCharacters,
    { requireNonEmpty: true },
  );
  const updatedAt = conversationBoundedString(
    operation.updatedAt,
    `${field}.updatedAt`,
    CAVE_CONTRACT_LIMITS.errorMessageCharacters,
    { requireNonEmpty: true },
  );
  const idempotencyResultExpiresAt = conversationOptionalNonEmptyString(
    operation.idempotencyResultExpiresAt,
    `${field}.idempotencyResultExpiresAt`,
  );

  if (replayFloorEventId < 1 || replayFloorEventId > latestEventId + 1) {
    throw new CaveConversationSchemaError(`${field}.replayFloorEventId`);
  }
  if (
    CONVERSATION_TERMINAL_STATE_SET.has(state) &&
    (latestEventId < 1 || outputTurnId === undefined)
  ) {
    throw new CaveConversationSchemaError(`${field}.latestEventId`);
  }

  return {
    id,
    kind: kind,
    state: state as CaveConversationOperationState,
    originatingScope: originatingScope,
    conversationId,
    ...(inputTurnId === undefined ? {} : { inputTurnId }),
    ...(outputTurnId === undefined ? {} : { outputTurnId }),
    ...(retryOfTurnId === undefined ? {} : { retryOfTurnId }),
    ...(failureCode === undefined ? {} : { failureCode }),
    latestEventId,
    replayFloorEventId,
    createdAt,
    updatedAt,
    ...(idempotencyResultExpiresAt === undefined
      ? {}
      : { idempotencyResultExpiresAt }),
  };
}

const ERROR_ENVELOPE_KEYS = new Set(['code', 'message', 'retryable', 'details']);

function parseConversationErrorDetails(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const details = conversationObject(value, 'error.details');
  const entries = Object.entries(details);
  if (entries.length > CAVE_CONTRACT_LIMITS.errorDetailEntries) {
    throw new CaveConversationSchemaError('error.details');
  }
  return Object.fromEntries(
    entries.map(([key, entry]) => [
      key,
      conversationBoundedString(
        entry,
        `error.details.${key}`,
        CAVE_CONTRACT_LIMITS.errorDetailValueCharacters,
        { requireNonEmpty: true },
      ),
    ]),
  );
}

/**
 * The shared Client v1 envelope: apiVersion, compatibility, declaration
 * metadata, requestId bounds, and exactly one of `data` or `error`. A well-
 * formed error envelope becomes the typed route error so fixed codes and
 * bounded details (for example the `reconcile_required` reason) survive.
 *
 * The mutation contract's operation and capability declarations are not yet
 * declared by the authoritative fixture, so the envelope's declarations are
 * validated as declarations but not pinned to specific conversation
 * operation identifiers here. That pinning is an upstream-contract gap.
 */
function parseConversationEnvelopeMetadata(
  value: unknown,
): { envelope: JsonObject; requestId: string | undefined } {
  const envelope = conversationObject(value, 'response');
  const apiVersion = conversationString(envelope.apiVersion, 'response.apiVersion');
  if (apiVersion !== CAVE_CONTRACT_API_VERSION) {
    throw new CaveConversationSchemaError('response.apiVersion');
  }
  const minimumClientVersion = conversationString(
    envelope.minimumClientVersion,
    'response.minimumClientVersion',
  );
  conversationDeclarationIds(envelope.capabilities, 'response.capabilities');
  conversationDeclarationIds(envelope.operations, 'response.operations');

  let compatible: boolean;
  try {
    compatible = assessCompatibility(minimumClientVersion, CAVE_CLIENT_VERSION).compatible;
  } catch {
    throw new CaveConversationSchemaError('response.minimumClientVersion');
  }
  if (!compatible) {
    throw new CaveConversationResponseError(
      'incompatible_version',
      'Cave minimumClientVersion was not compatible.',
    );
  }

  const requestId =
    envelope.requestId === undefined
      ? undefined
      : conversationBoundedString(
          envelope.requestId,
          'response.requestId',
          CAVE_CONTRACT_LIMITS.requestIdCharacters,
          { requireNonEmpty: true },
        );

  const hasData = envelope.data !== undefined;
  const hasError = envelope.error !== undefined;
  if (hasData === hasError) {
    throw new CaveConversationSchemaError('response');
  }

  if (hasError) {
    const error = conversationObject(envelope.error, 'error');
    conversationExactKeys(error, ERROR_ENVELOPE_KEYS, 'error');
    const code = conversationString(error.code, 'error.code');
    if (!isCaveContractErrorCode(code)) {
      throw new CaveConversationSchemaError('error.code');
    }
    const message = conversationBoundedString(
      error.message,
      'error.message',
      CAVE_CONTRACT_LIMITS.errorMessageCharacters,
      { requireNonEmpty: true },
    );
    const retryable = conversationBoolean(error.retryable, 'error.retryable');
    const details = parseConversationErrorDetails(error.details);
    throw new CaveConversationResponseError(code, message, {
      retryable,
      ...(details === undefined ? {} : { details }),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  return { envelope, requestId };
}

const CREATE_RESULT_KEYS = new Set(['operationId', 'replayed', 'conversation']);
const SEND_RESULT_KEYS = new Set(['operation', 'replayed']);
const OPERATION_RESULT_KEYS = new Set(['operation']);

/** The recorded create result: operation UUID, replay flag, canonical conversation. */
export function parseCreateConversationResult(
  value: unknown,
  expectedOperationId: CaveConversationOperationId,
): CaveCreateConversationResult {
  const { envelope } = parseConversationEnvelopeMetadata(value);
  const data = conversationObject(envelope.data, 'data');
  conversationExactKeys(data, CREATE_RESULT_KEYS, 'data');

  const operationId = validateConversationOperationId(data.operationId);
  if (operationId !== expectedOperationId) {
    throw new CaveConversationSchemaError('data.operationId');
  }
  const replayed = conversationBoolean(data.replayed, 'data.replayed');
  const conversation = parseConversation(data.conversation, 'data.conversation');

  return { operationId, replayed, conversation };
}

/** The send/retry acceptance result: the claimed operation and replay flag. */
export function parseSendConversationMessageResult(
  value: unknown,
  expectedOperationId: CaveConversationOperationId,
): CaveSendConversationMessageResult {
  const { envelope } = parseConversationEnvelopeMetadata(value);
  const data = conversationObject(envelope.data, 'data');
  conversationExactKeys(data, SEND_RESULT_KEYS, 'data');
  const operation = parseConversationOperation(data.operation, 'data.operation');
  if (operation.id !== expectedOperationId) {
    throw new CaveConversationSchemaError('data.operation.id');
  }
  const replayed = conversationBoolean(data.replayed, 'data.replayed');
  return { operation, replayed };
}

/** One non-content operation record, as read and stop routes return it. */
export function parseConversationOperationResponse(
  value: unknown,
  expectedOperationId: CaveConversationOperationId,
): CaveConversationOperation {
  const { envelope } = parseConversationEnvelopeMetadata(value);
  const data = conversationObject(envelope.data, 'data');
  conversationExactKeys(data, OPERATION_RESULT_KEYS, 'data');
  const operation = parseConversationOperation(data.operation, 'data.operation');
  if (operation.id !== expectedOperationId) {
    throw new CaveConversationSchemaError('data.operation.id');
  }
  return operation;
}

const EVENT_PAYLOAD_KEYS: Record<string, ReadonlySet<string>> = {
  'operation.accepted': new Set(['conversationId', 'inputTurnId', 'retryOfTurnId']),
  'assistant.delta': new Set(['text']),
  'operation.stopping': new Set<string>([]),
  'operation.completed': new Set(['outputTurnId']),
  'operation.failed': new Set(['outputTurnId', 'code']),
  'operation.cancelled': new Set(['outputTurnId']),
};

function parseConversationEvent(
  value: unknown,
  expectedOperationId: string,
  field: string,
): CaveConversationEvent {
  const event = conversationObject(value, field);
  const type = conversationString(event.type, `${field}.type`);
  if (!CONVERSATION_EVENT_TYPE_SET.has(type)) {
    throw new CaveConversationSchemaError(`${field}.type`);
  }
  const allowed = new Set<string>([
    'type',
    'operationId',
    'eventId',
    'cursor',
    'occurredAt',
  ]);
  const payloadKeys = EVENT_PAYLOAD_KEYS[type];
  if (payloadKeys === undefined) {
    throw new CaveConversationSchemaError(`${field}.type`);
  }
  for (const key of payloadKeys) {
    allowed.add(key);
  }
  conversationExactKeys(event, allowed, field);

  if (
    conversationString(event.operationId, `${field}.operationId`) !==
    expectedOperationId
  ) {
    throw new CaveConversationSchemaError(`${field}.operationId`);
  }
  const eventId = conversationCount(event.eventId, `${field}.eventId`);
  if (eventId < 1) {
    throw new CaveConversationSchemaError(`${field}.eventId`);
  }
  const cursor = conversationBoundedString(
    event.cursor,
    `${field}.cursor`,
    CAVE_CONTRACT_LIMITS.cursorCharacters,
    { requireNonEmpty: true },
  );
  const occurredAt = conversationBoundedString(
    event.occurredAt,
    `${field}.occurredAt`,
    CAVE_CONTRACT_LIMITS.requestIdCharacters,
    { requireNonEmpty: true },
  );
  const base = {
    type: type as CaveConversationEventType,
    operationId: expectedOperationId,
    eventId,
    cursor,
    occurredAt,
  };

  if (type === 'assistant.delta') {
    return { ...base, type, text: conversationString(event.text, `${field}.text`) };
  }
  if (type === 'operation.stopping') {
    return { ...base, type };
  }

  if (type === 'operation.accepted') {
    const conversationId = conversationBoundedString(
      event.conversationId,
      `${field}.conversationId`,
      CAVE_CONTRACT_LIMITS.cursorCharacters,
      { requireNonEmpty: true },
    );
    const inputTurnId = conversationBoundedString(
      event.inputTurnId,
      `${field}.inputTurnId`,
      CAVE_CONTRACT_LIMITS.cursorCharacters,
      { requireNonEmpty: true },
    );
    const retryOfTurnId = conversationOptionalNonEmptyString(
      event.retryOfTurnId,
      `${field}.retryOfTurnId`,
    );
    return {
      ...base,
      type,
      conversationId,
      inputTurnId,
      ...(retryOfTurnId === undefined ? {} : { retryOfTurnId }),
    };
  }
  const outputTurnId = conversationBoundedString(
    event.outputTurnId,
    `${field}.outputTurnId`,
    CAVE_CONTRACT_LIMITS.cursorCharacters,
    { requireNonEmpty: true },
  );
  if (type === 'operation.failed') {
    const code = conversationBoundedString(
      event.code,
      `${field}.code`,
      CAVE_CONTRACT_LIMITS.declarationIdCharacters,
      { requireNonEmpty: true },
    );
    return { ...base, type, outputTurnId, code };
  }
  if (type === 'operation.completed' || type === 'operation.cancelled') {
    return { ...base, type, outputTurnId };
  }
  // The remaining event kinds were all handled above; an event whose type
  // passed the allowlist cannot reach here.
  throw new CaveConversationSchemaError(`${field}.type`);
}

function isTerminalEventType(event: CaveConversationEvent): boolean {
  return (
    event.type === 'operation.completed' ||
    event.type === 'operation.failed' ||
    event.type === 'operation.cancelled'
  );
}

export interface CaveConversationTranslatedPage {
  operation: CaveConversationOperation;
  events: readonly CaveConversationEvent[];
  complete: boolean;
  requestId: string | undefined;
  nextCursor?: CaveConversationEventCursor;
}

const PAGE_DATA_KEYS = new Set(['operation', 'events', 'complete', 'cursor']);
const PAGE_CURSOR_KEYS = new Set(['current', 'next', 'hasMore']);

export interface CaveConversationEventTranslator {
  readonly operationId: CaveConversationOperationId;
  readonly deliveredThroughEventId: number;
  /**
   * Validate one raw event-page response and return the accepted events in
   * wire order. Throws a protocol error on any violation.
   */
  translate(page: unknown): CaveConversationTranslatedPage;
  /** Advance the accepted cursor after the event has been delivered. */
  commit(eventId: number): void;
}

export interface CaveConversationEventTranslatorOptions {
  /**
   * True when this stream's first page resumes behind an opaque cursor from
   * an earlier generator run: the first accepted event then cannot be
   * gap-checked against a known event ID. A fresh stream must begin at
   * event 1.
   */
  resumeAfterOpaqueCursor?: boolean;
}

/**
 * The one parser/translator for conversation event pages. Initial attachment
 * and every resumed long poll pass through it.
 *
 * The translator validates the shared Client v1 envelope before event data,
 * validates the operation ID on every event, requires contiguous increasing
 * event IDs, suppresses an exact duplicate event at or below the caller's
 * accepted cursor, and refuses forward gaps, reordered events, changed
 * operation IDs, malformed terminal sequences, and events after terminal as
 * protocol violations. The resume cursor advances only when the caller
 * commits, after the corresponding event has been delivered.
 */
export function createConversationEventTranslator(
  operationId: CaveConversationOperationId,
  options: CaveConversationEventTranslatorOptions = {},
): CaveConversationEventTranslator {
  const operationIdCanonical = validateConversationOperationId(operationId);
  let deliveredThrough = 0;
  let firstPage = true;
  let sawStopping = false;
  let sawTerminal = false;

  return {
    get operationId(): CaveConversationOperationId {
      return operationIdCanonical;
    },
    get deliveredThroughEventId(): number {
      return deliveredThrough;
    },
    commit(eventId: number): void {
      if (!Number.isSafeInteger(eventId) || eventId < 1 || eventId < deliveredThrough) {
        throw new OperationConfigurationError(
          'commit must advance the accepted cursor monotonically',
        );
      }
      deliveredThrough = eventId;
    },
    translate(page: unknown): CaveConversationTranslatedPage {
      if (sawTerminal) {
        throw new CaveConversationResponseError(
          'invalid_response',
          'Conversation event stream continued after a terminal event.',
          { retryable: false },
        );
      }

      const { envelope, requestId } = parseConversationEnvelopeMetadata(page);
      const data = conversationObject(envelope.data, 'data');
      conversationExactKeys(data, PAGE_DATA_KEYS, 'data');

      const operation = parseConversationOperation(data.operation, 'data.operation');
      if (operation.id !== operationIdCanonical) {
        throw new CaveConversationSchemaError('data.operation.id');
      }
      const complete = conversationBoolean(data.complete, 'data.complete');
      const eventsValue = data.events;
      if (!Array.isArray(eventsValue)) {
        throw new CaveConversationSchemaError('data.events');
      }
      let nextCursor: CaveConversationEventCursor | undefined;
      if (data.cursor !== undefined) {
        const cursorRecord = conversationObject(data.cursor, 'data.cursor');
        conversationExactKeys(cursorRecord, PAGE_CURSOR_KEYS, 'data.cursor');
        conversationBoolean(cursorRecord.hasMore, 'data.cursor.hasMore');
        if (cursorRecord.next !== undefined) {
          nextCursor = conversationBoundedString(
            cursorRecord.next,
            'data.cursor.next',
            CAVE_CONTRACT_LIMITS.cursorCharacters,
            { requireNonEmpty: true },
          );
        }
        if (cursorRecord.current !== undefined) {
          conversationBoundedString(
            cursorRecord.current,
            'data.cursor.current',
            CAVE_CONTRACT_LIMITS.cursorCharacters,
            { requireNonEmpty: true },
          );
        }
      }

      const events: CaveConversationEvent[] = [];
      let lastAccepted: number | undefined;
      let pageSawTerminal: boolean = sawTerminal;

      for (const [index, entry] of eventsValue.entries()) {
        const event = parseConversationEvent(
          entry,
          operation.id,
          `data.events[${index}]`,
        );
        const { eventId } = event;

        // Exact duplicates at or below the accepted cursor are suppressed,
        // never re-emitted and never treated as a gap.
        if (eventId <= deliveredThrough) {
          continue;
        }
        if (eventId > operation.latestEventId) {
          throw new CaveConversationResponseError(
            'invalid_response',
            'Conversation event page ran ahead of the operation record.',
            { retryable: false },
          );
        }
        if (lastAccepted === undefined) {
          if (
            !(firstPage && options.resumeAfterOpaqueCursor === true) &&
            eventId !== deliveredThrough + 1
          ) {
            throw new CaveConversationResponseError(
              'invalid_response',
              'Conversation event page did not continue the event stream.',
              { retryable: false },
            );
          }
        } else if (eventId !== lastAccepted + 1) {
          throw new CaveConversationResponseError(
            'invalid_response',
            'Conversation event page was not contiguous.',
            { retryable: false },
          );
        }

        // Any event in wire order after this page's terminal event is a
        // protocol violation.
        if (pageSawTerminal) {
          throw new CaveConversationResponseError(
            'invalid_response',
            'Conversation event page contained an event after the terminal event.',
            { retryable: false },
          );
        }

        if (event.type === 'operation.stopping') {
          if (sawStopping) {
            throw new CaveConversationResponseError(
              'invalid_response',
              'Conversation event page repeated stopping.',
              { retryable: false },
            );
          }
          sawStopping = true;
        }
        if (isTerminalEventType(event)) {
          pageSawTerminal = true;
        }

        lastAccepted = eventId;
        events.push(event);
      }

      if (complete && !CONVERSATION_TERMINAL_STATE_SET.has(operation.state)) {
        throw new CaveConversationResponseError(
          'invalid_response',
          'Conversation event page claimed completion for a non-terminal operation.',
          { retryable: false },
        );
      }
      const acceptedThrough = lastAccepted ?? deliveredThrough;
      // A first page resuming behind an opaque cursor cannot verify where
      // the accepted cursor sits (a terminal-cursor page arrives empty), so
      // the completion bound is only enforceable once an event ID is known.
      const opaqueResumeWithoutEvents =
        firstPage &&
        options.resumeAfterOpaqueCursor === true &&
        lastAccepted === undefined;
      if (
        complete &&
        !opaqueResumeWithoutEvents &&
        acceptedThrough !== operation.latestEventId
      ) {
        throw new CaveConversationResponseError(
          'invalid_response',
          'Conversation event page completed before the terminal event.',
          { retryable: false },
        );
      }

      if (pageSawTerminal) {
        sawTerminal = true;
      }
      firstPage = false;

      return {
        operation,
        events,
        complete,
        requestId,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      };
    },
  };
}

/**
 * The defined `reconcile_required` reasons, read from normalized error
 * details without trusting the error shape.
 */
export function caveConversationReconcileReason(
  error: unknown,
): CaveConversationReconcileReason | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  let code: unknown;
  let details: unknown;
  try {
    code = Reflect.get(error, 'code');
    details = Reflect.get(error, 'details');
  } catch {
    return undefined;
  }
  if (code !== 'reconcile_required' || typeof details !== 'object' || details === null) {
    return undefined;
  }
  let reason: unknown;
  try {
    reason = Reflect.get(details, 'reason');
  } catch {
    return undefined;
  }
  if (typeof reason !== 'string') {
    return undefined;
  }
  return CAVE_CONVERSATION_RECONCILE_REASONS.includes(
    reason as CaveConversationReconcileReason,
  )
    ? (reason as CaveConversationReconcileReason)
    : undefined;
}
