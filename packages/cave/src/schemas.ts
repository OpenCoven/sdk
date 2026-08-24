import {
  normalizePageOptions,
  type Page,
  type PageCursor,
} from '@opencoven/sdk-core';

import type {
  CaveDiscoveredEndpoint,
  CaveEndpointFreshness,
} from './discovery.js';
import type {
  CaveCanonicalFamiliar,
  CaveConversation,
  CaveConversationDetail,
  CaveMessage,
  CaveProject,
} from './types.js';

type JsonObject = Record<string, unknown>;

export class CaveCanonicalSchemaError extends TypeError {
  readonly field: string;

  constructor(field: string) {
    super(`${field} was malformed.`);
    this.name = 'CaveCanonicalSchemaError';
    this.field = field;
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

function optionalCanonicalString(
  value: unknown,
  field: string,
): string | undefined {
  return value === undefined ? undefined : canonicalString(value, field);
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new CaveCanonicalSchemaError(field);
  }

  return value.map((entry, index) =>
    canonicalString(entry, `${field}[${index}]`),
  );
}

function canonicalVersion(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new CaveCanonicalSchemaError(field);
  }

  return value;
}

function parseCanonicalCursor(value: unknown): PageCursor | undefined {
  if (value === undefined) {
    return undefined;
  }

  const cursor = canonicalObject(value, 'cursor');
  if (typeof cursor.hasMore !== 'boolean') {
    throw new CaveCanonicalSchemaError('cursor.hasMore');
  }

  const parsed: PageCursor = { hasMore: cursor.hasMore };
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

function parseCanonicalPage<T>(
  value: unknown,
  collection: string,
  parseEntry: (entry: unknown, field: string) => T,
): Page<T> {
  const envelope = canonicalObject(value, 'response');
  const data = canonicalObject(envelope.data, 'data');
  const entries = data[collection];
  if (!Array.isArray(entries)) {
    throw new CaveCanonicalSchemaError(`data.${collection}`);
  }

  const cursor = parseCanonicalCursor(envelope.cursor);
  return {
    data: entries.map((entry, index) =>
      parseEntry(entry, `data.${collection}[${index}]`),
    ),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function parseCanonicalFamiliar(
  value: unknown,
  field: string,
): CaveCanonicalFamiliar {
  const familiar = canonicalObject(value, field);

  return {
    id: canonicalString(familiar.id, `${field}.id`),
    name: canonicalString(familiar.name, `${field}.name`),
    repository: canonicalString(familiar.repository, `${field}.repository`),
    displayName: canonicalString(familiar.displayName, `${field}.displayName`),
    description: canonicalString(familiar.description, `${field}.description`),
    createdAt: canonicalString(familiar.createdAt, `${field}.createdAt`),
    updatedAt: canonicalString(familiar.updatedAt, `${field}.updatedAt`),
  };
}

function parseProject(value: unknown, field: string): CaveProject {
  const project = canonicalObject(value, field);

  return {
    id: canonicalString(project.id, `${field}.id`),
    name: canonicalString(project.name, `${field}.name`),
    familiarIds: canonicalStringArray(
      project.familiarIds,
      `${field}.familiarIds`,
    ),
    repository: canonicalString(project.repository, `${field}.repository`),
    defaultBranch: canonicalString(
      project.defaultBranch,
      `${field}.defaultBranch`,
    ),
    createdAt: canonicalString(project.createdAt, `${field}.createdAt`),
    updatedAt: canonicalString(project.updatedAt, `${field}.updatedAt`),
  };
}

function parseConversation(
  value: unknown,
  field: string,
): CaveConversation {
  const conversation = canonicalObject(value, field);
  const projectId = optionalCanonicalString(
    conversation.projectId,
    `${field}.projectId`,
  );
  const title = optionalCanonicalString(conversation.title, `${field}.title`);
  const createdAt = optionalCanonicalString(
    conversation.createdAt,
    `${field}.createdAt`,
  );

  return {
    id: canonicalString(conversation.id, `${field}.id`),
    familiarId: canonicalString(
      conversation.familiarId,
      `${field}.familiarId`,
    ),
    ...(projectId === undefined ? {} : { projectId }),
    ...(title === undefined ? {} : { title }),
    ...(createdAt === undefined ? {} : { createdAt }),
    updatedAt: canonicalString(conversation.updatedAt, `${field}.updatedAt`),
  };
}

function parseConversationDetail(
  value: unknown,
  field: string,
): CaveConversationDetail {
  const detail = canonicalObject(value, field);
  const conversation = parseConversation(detail, field);
  const metadata = canonicalObject(detail.metadata, `${field}.metadata`);
  const state = canonicalObject(detail.state, `${field}.state`);
  const headMessageId = optionalCanonicalString(
    detail.headMessageId,
    `${field}.headMessageId`,
  );

  return {
    ...conversation,
    metadata,
    branchId: canonicalString(detail.branchId, `${field}.branchId`),
    ...(headMessageId === undefined ? {} : { headMessageId }),
    state: {
      activePath: canonicalStringArray(
        state.activePath,
        `${field}.state.activePath`,
      ),
      currentVersion: canonicalVersion(
        state.currentVersion,
        `${field}.state.currentVersion`,
      ),
      baseVersion: canonicalVersion(
        state.baseVersion,
        `${field}.state.baseVersion`,
      ),
    },
  };
}

function parseMessage(value: unknown, field: string): CaveMessage {
  const message = canonicalObject(value, field);
  const parentId =
    message.parentId === null
      ? null
      : canonicalString(message.parentId, `${field}.parentId`);
  const familiarId = optionalCanonicalString(
    message.familiarId,
    `${field}.familiarId`,
  );
  const metadata =
    message.metadata === undefined
      ? undefined
      : canonicalObject(message.metadata, `${field}.metadata`);

  return {
    id: canonicalString(message.id, `${field}.id`),
    parentId,
    type: canonicalString(message.type, `${field}.type`),
    content: canonicalString(message.content, `${field}.content`),
    createdAt: canonicalString(message.createdAt, `${field}.createdAt`),
    ...(familiarId === undefined ? {} : { familiarId }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function parseCanonicalFamiliarsEnvelope(
  value: unknown,
): Page<CaveCanonicalFamiliar> {
  return parseCanonicalPage(value, 'familiars', parseCanonicalFamiliar);
}

export function parseProjectsEnvelope(value: unknown): Page<CaveProject> {
  return parseCanonicalPage(value, 'projects', parseProject);
}

export function parseConversationsEnvelope(
  value: unknown,
): Page<CaveConversation> {
  return parseCanonicalPage(value, 'conversations', parseConversation);
}

export function parseConversationEnvelope(
  value: unknown,
): CaveConversationDetail {
  const envelope = canonicalObject(value, 'response');
  const data = canonicalObject(envelope.data, 'data');

  return parseConversationDetail(data.conversation, 'data.conversation');
}

export function parseMessagesEnvelope(value: unknown): Page<CaveMessage> {
  return parseCanonicalPage(value, 'messages', parseMessage);
}

export interface CaveHealth {
  status: 'ok';
  apiVersion: string;
  minimumClientVersion: string;
  capabilities: readonly string[];
  operations: readonly string[];
  instanceId: string;
  pairingRequired: boolean;
  releaseVersion: string;
}

export interface CaveHealthData {
  instanceId: string;
  pairingRequired: boolean;
  releaseVersion: string;
}

export interface CaveHealthResponse {
  apiVersion: string;
  minimumClientVersion: string;
  requestId?: string;
  capabilities: readonly string[];
  operations: readonly string[];
  data: CaveHealthData;
}

export const CAVE_PAIRING_SCOPES = [
  'chat:read',
  'chat:write',
  'conversations:write',
  'attachments:write',
  'tasks:write',
  'github:write',
] as const;

export type CavePairingScope = (typeof CAVE_PAIRING_SCOPES)[number];

export const CAVE_PAIRING_STATUSES = [
  'pending',
  'approved',
  'denied',
  'expired',
] as const;

export type CavePairingState = (typeof CAVE_PAIRING_STATUSES)[number];

export interface CavePairingRequest {
  appName: string;
  installationId: string;
  scopes: CavePairingScope[];
}

export interface CavePairingCreated {
  requestId: string;
  secret: string;
  expiresAt: number;
}

export interface CavePairingStatus {
  id: string;
  status: CavePairingState;
  expiresAt: number;
}

export interface CaveCredentialMetadata {
  id: string;
  appName: string;
  installationId: string;
  scopes: CavePairingScope[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  revocationReason: string | null;
}

export interface CavePairingExchange {
  bearer: string;
  credential: CaveCredentialMetadata;
}

export interface CaveAuthorityBinding {
  version: CaveDiscoveredEndpoint['version'];
  instanceId: string;
  endpoint: CaveDiscoveredEndpoint['endpoint'];
  record: {
    identity: string;
    device: number;
    inode: number;
  };
  freshness: CaveEndpointFreshness;
}

export interface CaveAuthorityBoundPairingExchange extends CavePairingExchange {
  authorityBinding: CaveAuthorityBinding;
}

export type CaveCredentialAccess =
  | 'chat:read'
  | 'scope_denied'
  | 'service_unavailable'
  | 'rate_limited';

export type CaveCredentialDisconnectedReason =
  | 'credential_update_in_progress'
  | 'reconcile_required';

export type CaveCredentialStatus =
  | { status: 'missing' }
  | { status: 'disconnected'; reason: CaveCredentialDisconnectedReason }
  | { status: 'revoked'; health: CaveHealth }
  | { status: 'valid'; access: CaveCredentialAccess; health: CaveHealth };

/**
 * Familiars.
 *
 * These mirror what Cave already serves, rather than proposing a shape it does
 * not have: `GET /api/familiars` for the roster, `/[id]/contract` for the
 * Familiar Contract report, and `/[id]/execution-analytics` for run history.
 * Field-for-field, so a change on either side is a type error rather than a
 * value that silently arrives as undefined.
 *
 * The wire uses snake_case on the roster and camelCase everywhere else. The
 * `*Wire` types below keep the wire spelling exactly, because that is what has
 * to be validated; the exported types are camelCase, because that is what the
 * rest of a TypeScript program expects. The client is the one place the two
 * meet, and it is a better place for the seam than every call site.
 */

/** A familiar as the roster lists it. */
export interface CaveFamiliar {
  id: string;
  displayName: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  lastSeen?: string;
  activeSessions?: number;
  memoryFreshness?: string;
}

/** The roster entry as it arrives. */
export interface CaveFamiliarWire {
  id: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  last_seen?: string;
  active_sessions?: number;
  memory_freshness?: string;
}

export interface CaveFamiliarsResponse {
  ok: boolean;
  familiars?: CaveFamiliarWire[];
  error?: string;
  reason?: string;
}

/**
 * The five normative properties of the Familiar Contract, in the spec's order.
 *
 * Duplicated from Cave rather than imported because the SDK does not depend on
 * Cave's source. The contract report carries its own `specVersion`, so a client
 * that finds a property it does not know about can say which version it was
 * built against instead of guessing.
 */
export const CAVE_FAMILIAR_PROPERTIES = [
  'Named Identity',
  'Defined Purpose',
  'Bounded Authority',
  'Persistent Memory',
  'Human Belonging',
] as const;

export type CaveFamiliarProperty = (typeof CAVE_FAMILIAR_PROPERTIES)[number];

export type CaveContractFile = 'SOUL.md' | 'IDENTITY.md' | 'ward.toml' | 'MEMORY.md' | 'cross-file';

export interface CaveContractViolation {
  file: CaveContractFile;
  field: string;
  message: string;
}

export interface CavePropertyCoverage {
  property: string;
  pass: boolean;
}

/**
 * `pass` is true when there are zero hard violations. Warnings do not fail a
 * contract -- a familiar that keeps no memory is a real answer to a real
 * question, not a malformed one.
 */
export interface CaveContractReport {
  specVersion: string;
  pass: boolean;
  properties: CavePropertyCoverage[];
  violations: CaveContractViolation[];
  warnings: CaveContractViolation[];
}

export interface CaveFamiliarContract {
  id: string;
  workspace?: string;
  present: boolean;
  report: CaveContractReport;
}

export interface CaveFamiliarContractResponse {
  ok: boolean;
  /** Present on a refusal. The client surfaces it as the error code. */
  reason?: string;
  id?: string;
  workspace?: string;
  present?: boolean;
  report?: CaveContractReport;
  error?: string;
}

/** The windows Cave aggregates over. */
export const CAVE_ANALYTICS_WINDOWS = ['7d', '14d', '8w', 'all'] as const;

export type CaveAnalyticsWindowKey = (typeof CAVE_ANALYTICS_WINDOWS)[number];

export interface CaveExecutionSlice {
  key: string;
  label?: string;
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  medianDurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
}

export interface CaveExecutionCoverage {
  known: number;
  total: number;
  ratio: number;
}

export interface CaveExecutionWindow {
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** Null when there were no attempts: a rate over nothing is not zero. */
  successRate: number | null;
  medianDurationMs?: number;
  p95DurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
  models: CaveExecutionSlice[];
  harnesses: CaveExecutionSlice[];
  coverage: Record<string, CaveExecutionCoverage>;
}

export interface CaveExecutionAttempt {
  id: string;
  sessionId?: string;
  turnId?: string;
  executionKind: string;
  occurredAt: string;
  harnessId: string;
  harnessVersion?: string;
  requestedModel?: string;
  forwardedModel?: string;
  confirmedModel?: string;
  status: 'completed' | 'failed' | 'cancelled';
  durationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
}

/**
 * Whether the history behind these numbers is complete.
 *
 * Reported rather than hidden, because a success rate drawn from a partial
 * import is a different claim from one drawn from all of it, and a reader who
 * cannot tell them apart will believe the wrong one.
 */
export interface CaveExecutionBackfill {
  state: 'complete' | 'partial' | 'not-started';
  imported: number;
  remaining?: number;
}

export interface CaveFamiliarAnalytics {
  generatedAt: string;
  windows: Partial<Record<CaveAnalyticsWindowKey, CaveExecutionWindow>>;
  recentAttempts: CaveExecutionAttempt[];
  backfill: CaveExecutionBackfill;
}

export interface CaveFamiliarAnalyticsResponse {
  ok: boolean;
  /** Present on a refusal. The client surfaces it as the error code. */
  reason?: string;
  analytics?: CaveFamiliarAnalytics;
  error?: string;
}
