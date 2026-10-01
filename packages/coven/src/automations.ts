import {
  iteratePages,
  runOperation,
  type BoundedPageOptions,
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
import { historyCursor } from './automations-history.js';
import {
  COMMAND_ENVELOPE_ACTION, commandOptions, decodeCommand, definitionRequest, lifecycleRequest,
  type CovenAutomationCommandContext, type CovenAutomationCommandRequest, type CovenAutomationCommandResult,
  type CovenAutomationDraftInput, type CovenAutomationLifecycleCommand, type CovenAutomationLifecycleOptions,
  type CovenAutomationRevisionInput,
} from './automations-commands.js';
import {
  RUN_HISTORY_CURSOR_MAX_LENGTH,
  type CovenAutomationRun, type CovenAutomationRunHistoryOptions, type CovenAutomationRunHistoryPage,
  type CovenAutomationRunsOptions, type CovenAutomationRunsResult,
} from './automations-runs.js';
import {
  eventsOptions, eventsRequest, subscribeEvents, type CovenAutomationEventPage, type CovenAutomationEventsOptions,
} from './automations-events.js';
import {
  occurrenceView,
  type CovenAutomationOccurrence,
  type CovenAutomationOccurrenceHistoryOptions, type CovenAutomationOccurrenceHistoryPage,
  type CovenAutomationOccurrencesOptions, type CovenAutomationOccurrencesResult, type CovenAutomationOccurrenceResult,
  type CovenAutomationRunResult,
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
  /**
   * Sends one lifecycle command envelope. Optional: a transport without it
   * cannot mutate, and commands fail with `unsupported_operation`.
   */
  sendCommand?(request: CovenAutomationCommandRequest, context: OperationContext): Promise<{
    readonly status: number;
    readonly body: Uint8Array;
  }>;
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
      Reflect.ownKeys(query).some((key) => key !== 'view' && key !== 'limit' && key !== 'automationId') ||
      (Object.hasOwn(query, 'automationId') &&
        (typeof query.automationId !== 'string' || query.automationId.trim().length === 0))) {
      return definitionReadFailure('invalid_options', 'automations.occurrences');
    }
    return await this.#read({
      action: 'coven.automations.occurrence.list.v1', view: query.view, limit: query.limit ?? 20,
      ...(Object.hasOwn(query, 'automationId') ? { automationId: query.automationId as string } : {}),
    }, options) as CovenAutomationOccurrencesResult;
  }

  /** One page of one automation's occurrences in every state, newest first. */
  async occurrenceHistory(
    automationId: string,
    query: CovenAutomationOccurrenceHistoryOptions = {},
    options: OperationOptions = {},
  ): Promise<CovenAutomationOccurrenceHistoryPage> {
    if (!object(query) || (query.limit !== undefined && !integer(query.limit, 1, 100)) ||
      Reflect.ownKeys(query).some((key) => key !== 'limit' && key !== 'cursor') ||
      (Object.hasOwn(query, 'cursor') && !historyCursor(query.cursor))) {
      return definitionReadFailure('invalid_options', 'automations.occurrenceHistory');
    }
    return await this.#read({
      action: 'coven.automations.occurrence.history.v1', automationId, limit: query.limit ?? 20,
      ...(Object.hasOwn(query, 'cursor') ? { cursor: query.cursor as string } : {}),
    }, options) as CovenAutomationOccurrenceHistoryPage;
  }

  /**
   * Every occurrence of one automation, newest first, across pages. Requires
   * `maxPages` or a caller-owned `signal`; `timeoutMs` bounds the whole walk.
   */
  iterateOccurrenceHistory(automationId: string, options: BoundedPageOptions): AsyncGenerator<CovenAutomationOccurrence> {
    const defaults = this.#options.operation;
    const timeoutMs = object(options) ? options.timeoutMs ?? defaults?.timeoutMs : undefined;
    const observer = object(options) ? options.observer ?? defaults?.observer : undefined;
    return iteratePages(
      ({ limit, cursor, signal }) =>
        this.occurrenceHistory(automationId, cursor === undefined ? { limit } : { limit, cursor }, { signal }),
      object(options) ? {
        ...options,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(observer === undefined ? {} : { observer }),
      } : options,
    );
  }

  /** One page of one automation's runs, optionally for one occurrence, newest first. */
  async runHistory(
    automationId: string,
    query: CovenAutomationRunHistoryOptions = {},
    options: OperationOptions = {},
  ): Promise<CovenAutomationRunHistoryPage> {
    if (!object(query) || (query.limit !== undefined && !integer(query.limit, 1, 100)) ||
      Reflect.ownKeys(query).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'occurrenceId') ||
      (Object.hasOwn(query, 'cursor') && !historyCursor(query.cursor, RUN_HISTORY_CURSOR_MAX_LENGTH)) ||
      (Object.hasOwn(query, 'occurrenceId') &&
        (typeof query.occurrenceId !== 'string' || query.occurrenceId.trim().length === 0))) {
      return definitionReadFailure('invalid_options', 'automations.runHistory');
    }
    return await this.#read({
      action: 'coven.automations.run.history.v1', automationId, limit: query.limit ?? 20,
      ...(Object.hasOwn(query, 'occurrenceId') ? { occurrenceId: query.occurrenceId as string } : {}),
      ...(Object.hasOwn(query, 'cursor') ? { cursor: query.cursor as string } : {}),
    }, options) as CovenAutomationRunHistoryPage;
  }

  /**
   * Every run of one automation, optionally for one occurrence, newest first
   * across pages. Requires `maxPages` or a caller-owned `signal`; `timeoutMs`
   * bounds the whole walk.
   */
  iterateRunHistory(
    automationId: string,
    options: BoundedPageOptions,
    query: { readonly occurrenceId?: string } = {},
  ): AsyncGenerator<CovenAutomationRun> {
    const defaults = this.#options.operation;
    const timeoutMs = object(options) ? options.timeoutMs ?? defaults?.timeoutMs : undefined;
    const observer = object(options) ? options.observer ?? defaults?.observer : undefined;
    // Pass the filter through as given, so runHistory validates it per page.
    const filter: { occurrenceId?: string } = object(query) && Object.hasOwn(query, 'occurrenceId')
      ? { occurrenceId: query.occurrenceId as string } : {};
    return iteratePages(
      ({ limit, cursor, signal }) =>
        this.runHistory(automationId, { ...filter, limit, ...(cursor === undefined ? {} : { cursor }) }, { signal }),
      object(options) ? {
        ...options,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(observer === undefined ? {} : { observer }),
      } : options,
    );
  }

  /**
   * `paused -> active` at `expectedRevision`. Returns the typed outcome; a
   * domain refusal is `outcome: 'rejected'`, not an exception. Throws
   * `outcome_unknown` when the request may have reached the producer but no
   * trustworthy answer came back: resend with the same `adoptionKey`.
   */
  async activate(
    automationId: string,
    expectedRevision: number,
    context: CovenAutomationCommandContext,
    options: CovenAutomationLifecycleOptions & OperationOptions = {},
  ): Promise<CovenAutomationCommandResult> {
    return await this.#lifecycle('definition.activate.v1', 'automations.activate', automationId, expectedRevision, context, options);
  }

  /** `active -> paused` at `expectedRevision`. Outcomes as for `activate`. */
  async pause(
    automationId: string,
    expectedRevision: number,
    context: CovenAutomationCommandContext,
    options: CovenAutomationLifecycleOptions & OperationOptions = {},
  ): Promise<CovenAutomationCommandResult> {
    return await this.#lifecycle('definition.pause.v1', 'automations.pause', automationId, expectedRevision, context, options);
  }

  /** Disables at `expectedRevision`; a disabled definition never reactivates directly. */
  async disable(
    automationId: string,
    expectedRevision: number,
    context: CovenAutomationCommandContext,
    options: CovenAutomationLifecycleOptions & OperationOptions = {},
  ): Promise<CovenAutomationCommandResult> {
    return await this.#lifecycle('definition.disable.v1', 'automations.disable', automationId, expectedRevision, context, options);
  }

  /** Tombstones at `expectedRevision`, retaining history. Takes no `reason`. */
  async tombstone(
    automationId: string,
    expectedRevision: number,
    context: CovenAutomationCommandContext,
    options: OperationOptions = {},
  ): Promise<CovenAutomationCommandResult> {
    return await this.#lifecycle('definition.tombstone.v1', 'automations.tombstone', automationId, expectedRevision, context, options);
  }

  /**
   * Creates a definition in `draft` from a rich body. The SDK sets
   * `revision: 1`, `lifecycleState` and the JCS `integrity`; nothing runs
   * until `activate`. Outcomes as for `activate`.
   */
  async createDraft(
    definition: CovenAutomationDraftInput,
    context: CovenAutomationCommandContext,
    options: OperationOptions = {},
  ): Promise<CovenAutomationCommandResult> {
    const operation = 'automations.createDraft';
    const [request, operationOptions] =
      this.#definitionRequest('definition.create.v1', operation, undefined, undefined, definition, context, options);
    return await this.#command(request, operation, operationOptions);
  }

  /**
   * Replaces the definition with the full next revision at `expectedRevision`.
   * The SDK sets `revision` and `integrity`; `lifecycleState` must be `paused`
   * (for a draft, invalid or paused definition) or `active` (for an active one).
   */
  async revise(
    automationId: string,
    expectedRevision: number,
    definition: CovenAutomationRevisionInput,
    context: CovenAutomationCommandContext,
    options: OperationOptions = {},
  ): Promise<CovenAutomationCommandResult> {
    const operation = 'automations.revise';
    const [request, operationOptions] =
      this.#definitionRequest('definition.revise.v1', operation, automationId, expectedRevision, definition, context, options);
    return await this.#command(request, operation, operationOptions);
  }

  #definitionRequest(
    command: 'definition.create.v1' | 'definition.revise.v1',
    operation: string,
    automationId: unknown,
    expectedRevision: unknown,
    definition: unknown,
    context: unknown,
    options: unknown,
  ): [CovenAutomationCommandRequest, OperationOptions] {
    try {
      const operationOptions = commandOptions(options, ['signal', 'timeoutMs', 'observer']);
      if (operationOptions === undefined) return definitionReadFailure('invalid_options', operation);
      return [
        definitionRequest(command, automationId, expectedRevision, definition, context, operation),
        operationOptions,
      ];
    } catch (error) {
      throw new CovenClientError(normalizeCovenError(error, operation));
    }
  }

  async #lifecycle(
    command: CovenAutomationLifecycleCommand,
    operation: string,
    automationId: string,
    expectedRevision: number,
    context: CovenAutomationCommandContext,
    options: CovenAutomationLifecycleOptions & OperationOptions,
  ): Promise<CovenAutomationCommandResult> {
    let request: CovenAutomationCommandRequest;
    let operationOptions: OperationOptions;
    try {
      const owned = commandOptions(options, ['reason', 'signal', 'timeoutMs', 'observer']);
      if (owned === undefined) return definitionReadFailure('invalid_options', operation);
      const { reason, ...rest } = owned;
      operationOptions = rest;
      request = lifecycleRequest(
        command, automationId, expectedRevision, context,
        Object.hasOwn(owned, 'reason') ? { reason } : {}, operation,
      );
    } catch (error) {
      throw new CovenClientError(normalizeCovenError(error, operation));
    }
    return await this.#command(request, operation, operationOptions);
  }

  async #command(
    request: CovenAutomationCommandRequest,
    operation: string,
    options: OperationOptions,
  ): Promise<CovenAutomationCommandResult> {
    const observer = options.observer ?? this.#options.operation?.observer;
    // Once the request is handed to the transport, a failure cannot prove the
    // command was not applied, so it surfaces as `outcome_unknown`.
    let sent = false;
    const unknown = (): never => {
      throw new CovenClientError(normalizeCovenError({ code: 'outcome_unknown', retryable: true }, operation));
    };
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
          const send = this.#options.transport.sendCommand?.bind(this.#options.transport);
          if (send === undefined) return definitionReadFailure('unsupported_operation', operation);
          const response = await this.#options.transport.capabilities(context);
          checkReadContext(context, operation);
          const advertised = decode(response.status, response.body);
          if (advertised.status !== 'available' || !advertised.actions.includes(COMMAND_ENVELOPE_ACTION) ||
            !advertised.actions.includes(`coven.automations.${request.envelope.command}`)) {
            return definitionReadFailure('capability_unsupported', operation);
          }
          checkReadContext(context, operation);
          sent = true;
          const result = await send(request, context);
          // A decoded answer is the producer's truth even if the caller aborts now.
          return decodeCommand(result.status, result.body, request) ?? unknown();
        },
      );
    } catch (error) {
      if (sent) unknown();
      throw new CovenClientError(normalizeCovenError(error, operation));
    }
  }

  /** One run and its attempts by run id, read from one producer snapshot. */
  async getRun(runId: string, options: OperationOptions = {}): Promise<CovenAutomationRunResult> {
    return await this.#read({ action: 'coven.automations.run.get.v1', id: runId }, options) as CovenAutomationRunResult;
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
    CovenAutomationOccurrencesResult | CovenAutomationOccurrenceHistoryPage | CovenAutomationOccurrenceResult |
    CovenAutomationRunResult | CovenAutomationRunHistoryPage | CovenAutomationReceiptResult | CovenAutomationEventPage> {
    const operation = request.action === 'coven.automations.definition.list.v1' ? 'automations.list'
      : request.action === 'coven.automations.health' ? 'automations.health'
      : request.action === 'coven.automations.occurrence.list.v1' ? 'automations.occurrences'
      : request.action === 'coven.automations.occurrence.history.v1' ? 'automations.occurrenceHistory'
      : request.action === 'coven.automations.occurrence.get.v1' ? 'automations.getOccurrence'
      : request.action === 'coven.automations.run.get.v1' ? 'automations.getRun'
      : request.action === 'coven.automations.run.history.v1' ? 'automations.runHistory'
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
