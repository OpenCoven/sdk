import { OperationConfigurationError } from '@opencoven/sdk-core/browser';

import {
  parsePrivilegedConfirmation,
  validatePrivilegedOperationId,
} from './privileged-capabilities.js';

/**
 * Explicitly confirmed GitHub actions for the privileged authority tier.
 *
 * The curated action union is deliberately EMPTY: the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `github:write` pairing scope but
 * no GitHub operation and no GitHub capability family, and no reviewed
 * producer contract has curated which GitHub actions exist. Naming concrete
 * action kinds here would fabricate a curation nobody reviewed, so the union
 * ships closed (`CaveGitHubActionKind` is `never`) and every request is
 * rejected before any capability or transport work — fail closed by
 * construction. When the upstream Cave producer contract curates the union,
 * `CAVE_GITHUB_ACTION_KINDS` gains its reviewed members and this module's
 * validation machinery (exact confirmation, operation-UUID idempotency,
 * bounded input) applies unchanged.
 *
 * Cave revalidates confirmation, scope, repository/project grant, and input
 * bounds regardless of client confirmation.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */

/**
 * The curated GitHub action union. Typed `readonly never[]` so that the
 * kind type itself is uninhabitable — fail closed at the type level. Empty
 * pending the upstream producer contract; never extended by client-side
 * guesswork.
 */
export const CAVE_GITHUB_ACTION_KINDS: readonly never[] = Object.freeze([]);

export type CaveGitHubActionKind = (typeof CAVE_GITHUB_ACTION_KINDS)[number];

/**
 * The shape every confirmed GitHub action request will take once the union
 * is curated. With the union empty, `action` is uninhabitable and no request
 * can be constructed — the type system itself refuses the mutation.
 */
export interface CaveGitHubActionRequest {
  readonly operationId: string;
  readonly confirmed: true;
  readonly conversationId: string;
  readonly action: CaveGitHubActionKind;
  /** Bounded string-valued action input; structure owned by the union member. */
  readonly input: Readonly<Record<string, string>>;
}

/**
 * Parse one confirmed GitHub action request. Confirmation, the operation
 * UUID, and the bounded shape are validated first; the action kind is then
 * checked against the curated union, which is empty today, so every kind is
 * rejected with the precise upstream gap — before any capability resolution
 * or transport dispatch, guaranteeing zero domain mutation.
 */
export function parseCaveGitHubActionRequest(
  value: unknown,
): CaveGitHubActionRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OperationConfigurationError(
      'submitGitHubAction request must be an object',
    );
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    'operationId',
    'confirmed',
    'conversationId',
    'action',
    'input',
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new OperationConfigurationError(
        'submitGitHubAction request has an unknown field',
      );
    }
  }
  parsePrivilegedConfirmation({ confirmed: record.confirmed });
  const operationId = validatePrivilegedOperationId(record.operationId);
  if (
    typeof record.conversationId !== 'string' ||
    record.conversationId.trim().length === 0
  ) {
    throw new OperationConfigurationError(
      'submitGitHubAction conversationId must be a non-empty string',
    );
  }
  if (
    typeof record.input !== 'object' ||
    record.input === null ||
    Array.isArray(record.input)
  ) {
    throw new OperationConfigurationError(
      'submitGitHubAction input must be an object',
    );
  }
  for (const [key, entry] of Object.entries(record.input)) {
    if (typeof entry !== 'string') {
      throw new OperationConfigurationError(
        'submitGitHubAction input must contain only strings',
      );
    }
    if (key.length === 0 || key.length > 64) {
      throw new OperationConfigurationError(
        'submitGitHubAction input keys must be at most 64 characters',
      );
    }
    if (entry.length > 256) {
      throw new OperationConfigurationError(
        'submitGitHubAction input values must be at most 256 characters',
      );
    }
  }
  if (typeof record.action !== 'string' || record.action.length === 0) {
    throw new OperationConfigurationError(
      'submitGitHubAction requires an action from the curated union',
    );
  }
  // The curated union is empty: no kind is declared, so no request passes.
  // The untrusted kind is never echoed back.
  if (
    !(CAVE_GITHUB_ACTION_KINDS as readonly string[]).includes(record.action)
  ) {
    throw new OperationConfigurationError(
      'submitGitHubAction action is not declared by the curated union; the authoritative Cave contract declares no GitHub operations',
    );
  }
  return Object.freeze({
    operationId,
    confirmed: true,
    conversationId: record.conversationId,
    action: record.action as CaveGitHubActionKind,
    input: Object.freeze({ ...record.input }),
  });
}
