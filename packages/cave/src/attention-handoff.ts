import { OperationConfigurationError } from '@opencoven/sdk-core/browser';

import { CAVE_CONTRACT_LIMITS } from './contract-constraints.js';
import {
  parsePrivilegedConfirmation,
  validatePrivilegedOperationId,
} from './privileged-capabilities.js';

/**
 * Attention responses and task handoffs for the privileged authority tier.
 *
 * The five handoff states — proposed, pending, completed, rejected, failed —
 * are kept strictly distinct: a handoff moves through the declared
 * transition map only, and terminal states accept no further transitions.
 * Attention responses carry a bounded note at most; no free-form payload
 * flows through this surface.
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `conversations:write` and
 * `tasks:write` pairing scopes but no attention or task operations and no
 * such capability families, so no transport binding or route path ships;
 * every call reports `unsupported_operation` until the producer contract
 * lands and `pnpm sync:contracts` imports it. The transition map below is
 * the SDK-owned request model; Cave owns the authoritative state machine
 * and revalidates every transition server-side.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */

export const CAVE_TASK_HANDOFF_STATES = [
  'proposed',
  'pending',
  'completed',
  'rejected',
  'failed',
] as const;

export type CaveTaskHandoffState = (typeof CAVE_TASK_HANDOFF_STATES)[number];

/**
 * The declared transition map. Every state is distinct; `completed`,
 * `rejected`, and `failed` are terminal.
 */
export const CAVE_TASK_HANDOFF_TRANSITIONS: Readonly<
  Record<CaveTaskHandoffState, readonly CaveTaskHandoffState[]>
> = Object.freeze({
  proposed: Object.freeze<CaveTaskHandoffState[]>(['pending']),
  pending: Object.freeze<CaveTaskHandoffState[]>([
    'completed',
    'rejected',
    'failed',
  ]),
  completed: Object.freeze<CaveTaskHandoffState[]>([]),
  rejected: Object.freeze<CaveTaskHandoffState[]>([]),
  failed: Object.freeze<CaveTaskHandoffState[]>([]),
});

export const CAVE_ATTENTION_RESPONSE_KINDS = [
  'acknowledge',
  'decline',
] as const;

export type CaveAttentionResponseKind =
  (typeof CAVE_ATTENTION_RESPONSE_KINDS)[number];

const TASK_HANDOFF_STATE_SET: ReadonlySet<string> = new Set(
  CAVE_TASK_HANDOFF_STATES,
);

const ATTENTION_RESPONSE_KIND_SET: ReadonlySet<string> = new Set(
  CAVE_ATTENTION_RESPONSE_KINDS,
);

function boundedReference(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OperationConfigurationError(`${label} must be a non-empty string`);
  }
  if (value === '.' || value === '..') {
    throw new OperationConfigurationError(
      `${label} must not be a dot path segment`,
    );
  }
  if (value.length > CAVE_CONTRACT_LIMITS.declarationIdCharacters) {
    throw new OperationConfigurationError(
      `${label} must be at most ${CAVE_CONTRACT_LIMITS.declarationIdCharacters} characters`,
    );
  }
  return value;
}

export interface CaveTaskHandoffRequest {
  readonly operationId: string;
  readonly confirmed: true;
  readonly conversationId: string;
  readonly handoffId: string;
  /** The state the handoff is known to be in. */
  readonly from: CaveTaskHandoffState;
  /** The requested next state; must be a legal transition from `from`. */
  readonly to: CaveTaskHandoffState;
}

export interface CaveAttentionResponseRequest {
  readonly operationId: string;
  readonly confirmed: true;
  readonly conversationId: string;
  readonly attentionId: string;
  readonly response: CaveAttentionResponseKind;
  readonly note?: string;
}

const TASK_HANDOFF_REQUEST_KEYS = new Set([
  'operationId',
  'confirmed',
  'conversationId',
  'handoffId',
  'from',
  'to',
]);

/**
 * Whether the declared model permits a handoff transition. Terminal states
 * transition to nothing; `proposed` only advances to `pending`.
 */
export function isCaveTaskHandoffTransition(
  from: CaveTaskHandoffState,
  to: CaveTaskHandoffState,
): boolean {
  return CAVE_TASK_HANDOFF_TRANSITIONS[from].includes(to);
}

/**
 * Parse one task-handoff request. The transition must be legal under the
 * declared map, and the five states remain strictly distinct: an unknown
 * state or a skipped transition is a configuration error before any
 * capability or transport work.
 */
export function parseCaveTaskHandoffRequest(
  value: unknown,
): CaveTaskHandoffRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationConfigurationError(
      'requestTaskHandoff request must be an object',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!TASK_HANDOFF_REQUEST_KEYS.has(key)) {
      throw new OperationConfigurationError(
        'requestTaskHandoff request has an unknown field',
      );
    }
  }
  parsePrivilegedConfirmation({ confirmed: record.confirmed });
  const operationId = validatePrivilegedOperationId(record.operationId);
  const conversationId = boundedReference(record.conversationId, 'conversationId');
  const handoffId = boundedReference(record.handoffId, 'handoffId');
  if (
    typeof record.from !== 'string' ||
    !TASK_HANDOFF_STATE_SET.has(record.from)
  ) {
    throw new OperationConfigurationError(
      'requestTaskHandoff from must be a declared handoff state',
    );
  }
  if (
    typeof record.to !== 'string' ||
    !TASK_HANDOFF_STATE_SET.has(record.to)
  ) {
    throw new OperationConfigurationError(
      'requestTaskHandoff to must be a declared handoff state',
    );
  }
  const from = record.from as CaveTaskHandoffState;
  const to = record.to as CaveTaskHandoffState;
  if (from === to || !isCaveTaskHandoffTransition(from, to)) {
    throw new OperationConfigurationError(
      'requestTaskHandoff transition is not declared',
    );
  }
  return Object.freeze({
    operationId,
    confirmed: true,
    conversationId,
    handoffId,
    from,
    to,
  });
}

const ATTENTION_REQUEST_KEYS = new Set([
  'operationId',
  'confirmed',
  'conversationId',
  'attentionId',
  'response',
  'note',
]);

/**
 * Parse one attention-response request. The response kind is a closed union
 * and the optional note is bounded; nothing else can be sent.
 */
export function parseCaveAttentionResponseRequest(
  value: unknown,
): CaveAttentionResponseRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationConfigurationError(
      'respondToAttention request must be an object',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ATTENTION_REQUEST_KEYS.has(key)) {
      throw new OperationConfigurationError(
        'respondToAttention request has an unknown field',
      );
    }
  }
  parsePrivilegedConfirmation({ confirmed: record.confirmed });
  const operationId = validatePrivilegedOperationId(record.operationId);
  const conversationId = boundedReference(record.conversationId, 'conversationId');
  const attentionId = boundedReference(record.attentionId, 'attentionId');
  if (
    typeof record.response !== 'string' ||
    !ATTENTION_RESPONSE_KIND_SET.has(record.response)
  ) {
    throw new OperationConfigurationError(
      'respondToAttention response must be a declared response kind',
    );
  }
  let note: string | undefined;
  if (record.note !== undefined) {
    if (typeof record.note !== 'string' || record.note.trim().length === 0) {
      throw new OperationConfigurationError(
        'respondToAttention note must be a non-empty string',
      );
    }
    if (record.note.length > CAVE_CONTRACT_LIMITS.errorMessageCharacters) {
      throw new OperationConfigurationError(
        `respondToAttention note must be at most ${CAVE_CONTRACT_LIMITS.errorMessageCharacters} characters`,
      );
    }
    note = record.note;
  }
  return Object.freeze({
    operationId,
    confirmed: true,
    conversationId,
    attentionId,
    response: record.response as CaveAttentionResponseKind,
    ...(note === undefined ? {} : { note }),
  });
}
