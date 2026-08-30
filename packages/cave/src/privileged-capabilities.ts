import { validateConversationOperationId } from './conversation-control.js';
import type {
  CaveContractOperation,
} from './contract-fixture.js';
import type { CavePairingScope } from './schemas.js';

/**
 * Privileged authority capabilities for the attachment, rich-content,
 * attention, task-handoff, and GitHub action tiers.
 *
 * Every privileged action class is gated by a capability resolution derived
 * from the authoritative Cave contract fixture this SDK vendors: an action
 * class is actionable only when the contract declares at least one operation
 * carrying the required scope. The pinned fixture (Cave `4adc97b1`) declares
 * the privileged scope names for pairing (`attachments:write`, `tasks:write`,
 * `github:write`, `chat:write`, `conversations:write`) but declares no
 * operation that uses them, so every privileged resolution is `undeclared`
 * today and the client reports `unsupported_operation` before any transport
 * dispatch. Nothing here invents routes, capability families, or scope names:
 * scope identifiers come from the fixture's pairing-scope list, and declared
 * operations come from the fixture's operation table.
 *
 * Resolutions are computed per call from the consulted contract data and
 * returned as frozen descriptors. No capability object is cached across
 * grants: Cave remains the sole authority for grants, confirmation
 * revalidation, idempotency, audit, and domain mutation.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */

export type CavePrivilegedActionClass =
  | 'attachment-transfer'
  | 'rich-content'
  | 'attention-response'
  | 'task-handoff'
  | 'github-action';

export const CAVE_PRIVILEGED_ACTION_CLASSES = [
  'attachment-transfer',
  'rich-content',
  'attention-response',
  'task-handoff',
  'github-action',
] as const;

export interface CavePrivilegedActionRequirement {
  readonly actionClass: CavePrivilegedActionClass;
  /** Drawn only from the fixture-declared pairing scope vocabulary. */
  readonly requiredScope: CavePairingScope;
  /** Every privileged action requires a direct, explicit confirmation. */
  readonly requiresConfirmation: true;
  /** Idempotency is keyed by the caller-supplied 36-character operation UUID. */
  readonly idempotencyKey: 'operation-uuid';
}

/**
 * The SDK-declared requirement mapping. Scope identifiers are the pairing
 * scopes the authoritative fixture declares; the authoritative grant mapping
 * is Cave's and is revalidated server-side regardless of these values.
 */
export const CAVE_PRIVILEGED_ACTION_REQUIREMENTS: Readonly<
  Record<CavePrivilegedActionClass, CavePrivilegedActionRequirement>
> = Object.freeze({
  'attachment-transfer': Object.freeze({
    actionClass: 'attachment-transfer',
    requiredScope: 'attachments:write',
    requiresConfirmation: true,
    idempotencyKey: 'operation-uuid',
  }),
  'rich-content': Object.freeze({
    actionClass: 'rich-content',
    requiredScope: 'chat:write',
    requiresConfirmation: true,
    idempotencyKey: 'operation-uuid',
  }),
  'attention-response': Object.freeze({
    actionClass: 'attention-response',
    requiredScope: 'conversations:write',
    requiresConfirmation: true,
    idempotencyKey: 'operation-uuid',
  }),
  'task-handoff': Object.freeze({
    actionClass: 'task-handoff',
    requiredScope: 'tasks:write',
    requiresConfirmation: true,
    idempotencyKey: 'operation-uuid',
  }),
  'github-action': Object.freeze({
    actionClass: 'github-action',
    requiredScope: 'github:write',
    requiresConfirmation: true,
    idempotencyKey: 'operation-uuid',
  }),
});

export interface CaveDeclaredOperationRef {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly scope: string | null;
}

export type CaveCapabilityStatus = 'declared' | 'undeclared';

export interface CaveCapabilityResolution {
  readonly actionClass: CavePrivilegedActionClass;
  readonly status: CaveCapabilityStatus;
  readonly requirement: CavePrivilegedActionRequirement;
  /**
   * The capability families the consulted contract declares. The pinned
   * fixture declares none of the privileged families.
   */
  readonly declaredCapabilities: readonly string[];
  /**
   * The operations the consulted contract declares with the required scope.
   * Empty for every privileged class under the pinned fixture.
   */
  readonly declaredOperations: readonly CaveDeclaredOperationRef[];
}

export interface CaveCapabilityRegistry {
  resolve(actionClass: CavePrivilegedActionClass): CaveCapabilityResolution;
}

export interface CaveCapabilityContractSource {
  readonly capabilities: readonly string[];
  readonly operations: readonly CaveContractOperation[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCavePrivilegedActionClass(value: unknown): value is CavePrivilegedActionClass {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(
      CAVE_PRIVILEGED_ACTION_REQUIREMENTS,
      value,
    )
  );
}

function frozenOperationRefs(
  operations: readonly CaveContractOperation[],
  requiredScope: string,
): readonly CaveDeclaredOperationRef[] {
  const declared: CaveDeclaredOperationRef[] = [];
  for (const operation of operations) {
    if (operation.scope !== requiredScope) {
      continue;
    }
    declared.push(
      Object.freeze({
        id: operation.id,
        method: operation.method,
        path: operation.path,
        scope: operation.scope,
      }),
    );
  }
  return Object.freeze(declared);
}

/**
 * Build a capability registry from a parsed (preferably digest-verified)
 * Client v1 contract fixture. Resolution consults the operation table on
 * every call: an action class is `declared` only when the contract declares
 * at least one operation carrying the required scope.
 */
export function createCaveCapabilityRegistry(
  contract: CaveCapabilityContractSource,
): CaveCapabilityRegistry {
  if (!isObject(contract)) {
    throw new TypeError('capability contract source must be an object');
  }
  if (!Array.isArray(contract.capabilities)) {
    throw new TypeError('capability contract source capabilities must be an array');
  }
  if (!Array.isArray(contract.operations)) {
    throw new TypeError('capability contract source operations must be an array');
  }

  // The runtime checks above defend the JS boundary; re-type the validated
  // data explicitly so the frozen copies below are well typed.
  const capabilities = Object.freeze([
    ...(contract.capabilities as readonly string[]),
  ]);
  const operations = Object.freeze([
    ...(contract.operations as readonly CaveContractOperation[]),
  ]);

  return {
    resolve(actionClass: CavePrivilegedActionClass): CaveCapabilityResolution {
      if (!isCavePrivilegedActionClass(actionClass)) {
        throw new TypeError('unknown privileged action class');
      }
      const requirement = CAVE_PRIVILEGED_ACTION_REQUIREMENTS[actionClass];
      const declaredOperations = frozenOperationRefs(
        operations,
        requirement.requiredScope,
      );
      return Object.freeze({
        actionClass,
        status: declaredOperations.length > 0 ? 'declared' : 'undeclared',
        requirement,
        declaredCapabilities: capabilities,
        declaredOperations,
      });
    },
  };
}

/**
 * The default capability source: the operation table of the authoritative
 * fixture pinned at Cave `4adc97b1` (digest `b2694cd1…`). Tests assert this
 * snapshot matches the vendored fixture exactly, so a fixture re-import
 * forces a reviewed update here. Under this contract every privileged action
 * class resolves `undeclared`.
 */
export const CAVE_DEFAULT_CAPABILITY_CONTRACT: CaveCapabilityContractSource =
  Object.freeze({
    capabilities: Object.freeze([
      'health',
      'pairing',
      'credentials',
      'familiars',
      'projects',
      'conversations',
      'conversation-messages',
      'cursors',
    ]),
    operations: Object.freeze([
      Object.freeze({
        id: 'health.read',
        families: Object.freeze(['health']),
        ingress: 'public',
        method: 'GET',
        path: '/api/client/v1/health',
        scope: null,
      }),
      Object.freeze({
        id: 'pairing.create',
        families: Object.freeze(['pairing']),
        ingress: 'public',
        method: 'POST',
        path: '/api/client/v1/pairing/requests',
        scope: null,
      }),
      Object.freeze({
        id: 'pairing.poll',
        families: Object.freeze(['pairing']),
        ingress: 'public',
        method: 'GET',
        path: '/api/client/v1/pairing/requests/:id',
        scope: null,
      }),
      Object.freeze({
        id: 'pairing.exchange',
        families: Object.freeze(['pairing']),
        ingress: 'public',
        method: 'POST',
        path: '/api/client/v1/pairing/requests/:id/exchange',
        scope: null,
      }),
      Object.freeze({
        id: 'pairing.admin.list',
        families: Object.freeze(['pairing']),
        ingress: 'admin',
        method: 'GET',
        path: '/api/client/v1/admin/pairing-requests',
        scope: null,
      }),
      Object.freeze({
        id: 'pairing.admin.decide',
        families: Object.freeze(['pairing']),
        ingress: 'admin',
        method: 'POST',
        path: '/api/client/v1/admin/pairing-requests/:id/decision',
        scope: null,
      }),
      Object.freeze({
        id: 'credentials.admin.list',
        families: Object.freeze(['credentials']),
        ingress: 'admin',
        method: 'GET',
        path: '/api/client/v1/admin/credentials',
        scope: null,
      }),
      Object.freeze({
        id: 'credentials.admin.revoke',
        families: Object.freeze(['credentials']),
        ingress: 'admin',
        method: 'DELETE',
        path: '/api/client/v1/admin/credentials/:id',
        scope: null,
      }),
      Object.freeze({
        id: 'familiars.list',
        families: Object.freeze(['familiars', 'cursors']),
        ingress: 'authenticated',
        method: 'GET',
        path: '/api/client/v1/familiars',
        scope: 'chat:read',
      }),
      Object.freeze({
        id: 'projects.list',
        families: Object.freeze(['projects', 'cursors']),
        ingress: 'authenticated',
        method: 'GET',
        path: '/api/client/v1/projects',
        scope: 'chat:read',
      }),
      Object.freeze({
        id: 'conversations.list',
        families: Object.freeze(['conversations', 'cursors']),
        ingress: 'authenticated',
        method: 'GET',
        path: '/api/client/v1/conversations',
        scope: 'chat:read',
      }),
      Object.freeze({
        id: 'conversations.read',
        families: Object.freeze(['conversations']),
        ingress: 'authenticated',
        method: 'GET',
        path: '/api/client/v1/conversations/:id',
        scope: 'chat:read',
      }),
      Object.freeze({
        id: 'messages.list',
        families: Object.freeze(['conversation-messages', 'cursors']),
        ingress: 'authenticated',
        method: 'GET',
        path: '/api/client/v1/conversations/:id/messages',
        scope: 'chat:read',
      }),
    ]),
  });

/**
 * The default registry every `CaveClient` uses when no explicit registry is
 * supplied. Under the pinned fixture all privileged action classes resolve
 * `undeclared`.
 */
export function createDefaultCaveCapabilityRegistry(): CaveCapabilityRegistry {
  return createCaveCapabilityRegistry(CAVE_DEFAULT_CAPABILITY_CONTRACT);
}

const CONFIRMATION_KEYS = new Set(['confirmed']);

/**
 * A privileged action carries a direct, explicit confirmation: exactly one
 * `confirmed` field whose value is the literal `true`. Anything else — a
 * missing field, `false`, a string, a truthy object — is a configuration
 * error raised before any capability or transport work.
 */
export function parsePrivilegedConfirmation(value: unknown): true {
  if (!isObject(value)) {
    throw new TypeError('privileged confirmation must be an object');
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || !CONFIRMATION_KEYS.has(keys[0] ?? '')) {
    throw new TypeError('privileged confirmation must contain exactly confirmed');
  }
  if (value.confirmed !== true) {
    throw new TypeError('privileged actions require confirmed to be exactly true');
  }
  return true;
}

/**
 * Privileged actions key idempotency with the same Client v1 operation UUID
 * contract as conversational control: exactly 36 characters, RFC-compatible,
 * normalized to lowercase.
 */
export function validatePrivilegedOperationId(value: unknown): string {
  return validateConversationOperationId(value);
}
