import {
  runOperation,
  type OperationContext,
  type OperationDefaults,
  type OperationOptions,
} from '@opencoven/sdk-core';

import { CovenClientError, normalizeCovenError } from './client.js';
import { parsePolicyJson } from './policy-json.js';

export interface CovenAutomationVariant {
  readonly variant: string;
  readonly profile?: string;
  readonly notes?: string;
}

export interface CovenAutomationCapabilityProfile {
  readonly version: 1;
  readonly contractProfile: 'coven.automations.v1';
  readonly description: string;
  readonly supported: {
    readonly triggers: readonly CovenAutomationVariant[];
    readonly conditions: readonly CovenAutomationVariant[];
    readonly actions: readonly CovenAutomationVariant[];
    readonly triggerPolicies: readonly CovenAutomationVariant[];
    readonly deliveryPolicies: readonly CovenAutomationVariant[];
    readonly retentionPolicies: readonly CovenAutomationVariant[];
  };
  readonly experimental: readonly CovenAutomationVariant[];
  readonly refused: readonly { readonly variant: string; readonly reason: string }[];
  readonly negotiationRules: readonly string[];
}

export type CovenAutomationCapabilities =
  | { readonly status: 'unavailable'; readonly reason: 'not_advertised' | 'planned' | 'profile_missing' }
  | {
    readonly status: 'available';
    readonly actions: readonly string[];
    readonly policy: 'allow' | 'requiresApproval';
    readonly variantNegotiation: CovenAutomationCapabilityProfile;
  };

export interface CovenAutomationsTransport {
  capabilities(context: OperationContext): Promise<{
    readonly status: number;
    readonly body: Uint8Array;
  }>;
}

export interface CovenAutomationsClientOptions {
  readonly transport: CovenAutomationsTransport;
  readonly operation?: OperationDefaults;
}

const operation = 'automations.capabilities';

function invalidResponse(): never {
  throw new CovenClientError(normalizeCovenError({ code: 'invalid_response' }, operation));
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

function variants(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry: unknown) =>
    object(entry) && typeof entry.variant === 'string' && entry.variant.length > 0 &&
    (entry.profile === undefined || typeof entry.profile === 'string') &&
    (entry.notes === undefined || typeof entry.notes === 'string'));
}

function profile(value: unknown): value is CovenAutomationCapabilityProfile {
  if (!object(value) || value.version !== 1 || value.contractProfile !== 'coven.automations.v1' ||
    typeof value.description !== 'string' || !object(value.supported)) return false;
  const supported = value.supported;
  return ['triggers', 'conditions', 'actions', 'triggerPolicies', 'deliveryPolicies', 'retentionPolicies']
    .every((key) => variants(supported[key])) &&
    variants(value.experimental) &&
    Array.isArray(value.refused) && value.refused.every((entry: unknown) =>
      object(entry) && typeof entry.variant === 'string' && entry.variant.length > 0 &&
      typeof entry.reason === 'string') &&
    strings(value.negotiationRules);
}

function decode(status: number, body: Uint8Array): CovenAutomationCapabilities {
  if (status !== 200 || !(body instanceof Uint8Array) || body.byteLength > 16_384) {
    return invalidResponse();
  }
  let value: unknown;
  try {
    value = parsePolicyJson(body, 16_384);
  } catch {
    return invalidResponse();
  }
  if (!object(value) || !Array.isArray(value.capabilities) ||
    !value.capabilities.every((entry: unknown) => object(entry) && typeof entry.id === 'string')) {
    return invalidResponse();
  }
  const entries = value.capabilities.filter((entry: Record<string, unknown>) => entry.id === 'coven.automations');
  if (entries.length === 0) return { status: 'unavailable', reason: 'not_advertised' };
  if (entries.length !== 1) return invalidResponse();
  const entry: unknown = entries[0];
  if (!object(entry) || typeof entry.label !== 'string' || typeof entry.adapter !== 'string' ||
    !strings(entry.actions) ||
    (entry.policy !== 'allow' && entry.policy !== 'requiresApproval') ||
    (entry.status !== 'available' && entry.status !== 'planned')) return invalidResponse();
  if (entry.status === 'planned') return { status: 'unavailable', reason: 'planned' };
  if (entry.variantNegotiation === undefined) return { status: 'unavailable', reason: 'profile_missing' };
  if (!profile(entry.variantNegotiation)) return invalidResponse();
  return {
    status: 'available',
    actions: entry.actions,
    policy: entry.policy,
    variantNegotiation: entry.variantNegotiation,
  };
}

/** Reads advertisements only; neither receipt authentication nor execution authorization. */
export class CovenAutomationsClient {
  readonly #options: CovenAutomationsClientOptions;

  constructor(options: CovenAutomationsClientOptions) {
    this.#options = options;
  }

  async capabilities(options: OperationOptions = {}): Promise<CovenAutomationCapabilities> {
    const observer = options.observer ?? this.#options.operation?.observer;
    try {
      return await runOperation(
        { system: 'coven', operation },
        {
          ...this.#options.operation,
          ...options,
          timeoutMs: options.timeoutMs ?? this.#options.operation?.timeoutMs ?? 5_000,
          ...(observer === undefined ? {} : { observer }),
        },
        async (context) => {
          const response = await this.#options.transport.capabilities(context);
          return decode(response.status, response.body);
        },
      );
    } catch (error) {
      // Do not retain daemon payloads, provider errors, or local endpoint paths.
      throw new CovenClientError(normalizeCovenError(error, operation));
    }
  }
}

export function createCovenAutomationsClient(options: CovenAutomationsClientOptions): CovenAutomationsClient {
  return new CovenAutomationsClient(options);
}
