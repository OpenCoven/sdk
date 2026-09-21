import {
  runOperation,
  type OperationContext,
  type OperationDefaults,
  type OperationOptions,
} from '@opencoven/sdk-core';

import { CovenClientError, normalizeCovenError } from './client-errors.js';
import { parsePolicyJson } from './policy-json.js';
import { integer, object } from './automations-read-validation.js';
import type { CovenAutomationReceiptResult } from './automations-receipts.js';
import {
  verifyReceipt,
  type CovenAutomationReceiptTrustContext, type CovenAutomationReceiptVerification,
} from './automations-receipt-verification.js';
import type { CovenAutomationRunsOptions, CovenAutomationRunsResult } from './automations-runs.js';
import {
  eventsOptions, eventsRequest, subscribeEvents, type CovenAutomationEventPage, type CovenAutomationEventsOptions,
} from './automations-events.js';
import {
  occurrenceView,
  type CovenAutomationOccurrencesOptions, type CovenAutomationOccurrencesResult, type CovenAutomationOccurrenceResult,
} from './automations-occurrences.js';
import {
  decodeDefinitionRead,
  definitionReadBytes,
  definitionReadFailure,
  type CovenAutomationDefinition,
  type CovenAutomationDefinitionList,
  type CovenAutomationDefinitionReadRequest,
  type CovenAutomationHealthResult,
  type CovenAutomationListOptions,
} from './automations-definitions.js';

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
  readDefinitions?(request: CovenAutomationDefinitionReadRequest, context: OperationContext): Promise<{
    readonly status: number;
    readonly body: Uint8Array;
  }>;
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

function checkReadContext(context: OperationContext, operation: string): void {
  context.signal.throwIfAborted();
  if (context.deadline !== undefined && context.deadline <= performance.now()) {
    definitionReadFailure('timeout', operation);
  }
}

function invalidResponse(): never {
  throw new CovenClientError(normalizeCovenError({ code: 'invalid_response' }, operation));
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

/** Reads advertisements and diagnostics; neither receipt authentication nor execution authorization. */
export class CovenAutomationsClient {
  readonly #options: CovenAutomationsClientOptions;

  constructor(options: CovenAutomationsClientOptions) {
    this.#options = options;
  }

  async list(query: CovenAutomationListOptions = {}, options: OperationOptions = {}): Promise<CovenAutomationDefinitionList> {
    if (!object(query) || (query.includeTombstoned !== undefined && typeof query.includeTombstoned !== 'boolean')) {
      return definitionReadFailure('invalid_options', 'automations.list');
    }
    return await this.#read({
      action: 'coven.automations.definition.list.v1',
      includeTombstoned: query.includeTombstoned ?? false,
    }, options) as CovenAutomationDefinitionList;
  }

  async get(id: string, options: OperationOptions = {}): Promise<CovenAutomationDefinition> {
    return await this.#read({ action: 'coven.automations.definition.get.v1', id }, options) as CovenAutomationDefinition;
  }

  async health(id: string, options: OperationOptions = {}): Promise<CovenAutomationHealthResult> {
    return await this.#read({ action: 'coven.automations.health', id }, options) as CovenAutomationHealthResult;
  }

  async runs(
    id: string,
    query: CovenAutomationRunsOptions = {},
    options: OperationOptions = {},
  ): Promise<CovenAutomationRunsResult> {
    if (!object(query) || (query.limit !== undefined && !integer(query.limit, 1, 100))) {
      return definitionReadFailure('invalid_options', 'automations.runs');
    }
    return await this.#read({
      action: 'coven.automations.runs', id, limit: query.limit ?? 20,
    }, options) as CovenAutomationRunsResult;
  }

  async occurrences(query: CovenAutomationOccurrencesOptions, options: OperationOptions = {}): Promise<CovenAutomationOccurrencesResult> {
    if (!object(query) || !occurrenceView(query.view) ||
      (query.limit !== undefined && !integer(query.limit, 1, 100)) ||
      Reflect.ownKeys(query).some((key) => key !== 'view' && key !== 'limit')) {
      return definitionReadFailure('invalid_options', 'automations.occurrences');
    }
    return await this.#read({
      action: 'coven.automations.occurrence.list.v1', view: query.view, limit: query.limit ?? 20,
    }, options) as CovenAutomationOccurrencesResult;
  }

  async getOccurrence(id: string, options: OperationOptions = {}): Promise<CovenAutomationOccurrenceResult> {
    return await this.#read({ action: 'coven.automations.occurrence.get.v1', id }, options) as CovenAutomationOccurrenceResult;
  }

  async getReceipt(id: string, options: OperationOptions = {}): Promise<CovenAutomationReceiptResult> {
    return await this.#read({ action: 'coven.automations.receipt.get.v1', id }, options) as CovenAutomationReceiptResult;
  }

  /** Local integrity and caller-binding checks; no transport or authentication inference. */
  verifyReceipt(receipt: unknown, trustContext: CovenAutomationReceiptTrustContext): CovenAutomationReceiptVerification {
    return verifyReceipt(receipt, trustContext);
  }

  async events(query: CovenAutomationEventsOptions, options: OperationOptions = {}): Promise<CovenAutomationEventPage> {
    return await this.#read(eventsRequest(query), eventsOptions(options)) as CovenAutomationEventPage;
  }

  subscribe(query: CovenAutomationEventsOptions, options: OperationOptions = {}): AsyncIterableIterator<CovenAutomationEventPage> {
    return subscribeEvents((query, options) => this.events(query, options), query, options);
  }

  async #read(
    request: CovenAutomationDefinitionReadRequest,
    options: OperationOptions,
  ): Promise<CovenAutomationDefinitionList | CovenAutomationDefinition | CovenAutomationHealthResult | CovenAutomationRunsResult |
    CovenAutomationOccurrencesResult | CovenAutomationOccurrenceResult | CovenAutomationReceiptResult | CovenAutomationEventPage> {
    const operation = request.action === 'coven.automations.definition.list.v1' ? 'automations.list'
      : request.action === 'coven.automations.health' ? 'automations.health'
      : request.action === 'coven.automations.occurrence.list.v1' ? 'automations.occurrences'
      : request.action === 'coven.automations.occurrence.get.v1' ? 'automations.getOccurrence'
      : request.action === 'coven.automations.receipt.get.v1' ? 'automations.getReceipt'
      : request.action === 'coven.automations.events.subscribe.v1' ? 'automations.events'
      : request.action === 'coven.automations.runs' ? 'automations.runs' : 'automations.get';
    const observer = options.observer ?? this.#options.operation?.observer;
    try {
      definitionReadBytes(request);
      return await runOperation(
        { system: 'coven', operation },
        {
          ...this.#options.operation,
          ...options,
          timeoutMs: options.timeoutMs ?? this.#options.operation?.timeoutMs ?? 5_000,
          ...(observer === undefined ? {} : { observer }),
        },
        async (context) => {
          const read = this.#options.transport.readDefinitions?.bind(this.#options.transport);
          if (read === undefined) return definitionReadFailure('unsupported_operation', operation);
          const response = await this.#options.transport.capabilities(context);
          checkReadContext(context, operation);
          const advertised = decode(response.status, response.body);
          if (advertised.status !== 'available' || !advertised.actions.includes(request.action)) {
            return definitionReadFailure('capability_unsupported', operation);
          }
          checkReadContext(context, operation);
          const result = await read(Object.freeze(request), context);
          checkReadContext(context, operation);
          const decoded = decodeDefinitionRead(result.status, result.body, request, operation);
          checkReadContext(context, operation);
          return decoded;
        },
      );
    } catch (error) {
      throw new CovenClientError(normalizeCovenError(error, operation));
    }
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
