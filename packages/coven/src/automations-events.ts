import { isDeepStrictEqual } from 'node:util';

import { createOperationScope, type OperationOptions, type OperationScope } from '@opencoven/sdk-core';

import { CovenClientError, normalizeCovenError } from './client-errors.js';
import { integer, object } from './automations-read-validation.js';
import type { CovenAutomationReceiptDigest } from './automations-receipts.js';

/** Domain streams only: the global feed has a separate, non-domain cursor. */
export interface CovenAutomationEventStream {
  readonly kind: 'automation' | 'occurrence' | 'run';
  readonly id: string;
}

export type CovenAutomationEventsOptions = { readonly stream: CovenAutomationEventStream } & (
  | { readonly after?: number; readonly checkpoint?: never }
  | { readonly checkpoint: string; readonly after?: never }
);

export type CovenAutomationEventsRequest = CovenAutomationEventsOptions & {
  readonly action: 'coven.automations.events.subscribe.v1';
};

interface EventBase {
  readonly schemaVersion: 'coven.automations.v1';
  readonly eventId: string;
  readonly stream: CovenAutomationEventStream;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly observedAt: string;
  readonly producer: { readonly component: string; readonly instanceId: string; readonly implementationVersion?: string };
  readonly causation?: { readonly adoptionKey?: string; readonly causeEventId?: string; readonly correlationId?: string };
  readonly automationId?: string;
  readonly occurrenceId?: string;
  readonly runId?: string;
  readonly attemptId?: string;
  readonly summary: string;
  readonly privacy: {
    readonly classification: 'public' | 'operational' | 'sensitive' | 'restricted';
    readonly retention: { readonly classification: 'ephemeral' | 'standard' | 'extended'; readonly deleteAfter?: string };
  };
  readonly integrity?: CovenAutomationReceiptDigest;
}

interface TransitionPayload {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly fenceGeneration?: number;
  readonly attemptNumber?: number;
  readonly commandAdoptionKey?: string;
}

/** Validated event data; integrity and producer fields are not authenticated claims. */
export type CovenAutomationEvent = EventBase & (
  | {
    readonly kind: 'definition.created' | 'definition.revised' | 'definition.activated' | 'definition.paused' |
      'definition.disabled' | 'definition.invalidated' | 'definition.tombstoned' | 'definition.imported';
    readonly payload: {
      readonly revision: number;
      readonly definitionDigest?: CovenAutomationReceiptDigest;
      readonly lifecycleState?: 'draft' | 'paused' | 'active' | 'disabled' | 'invalid' | 'tombstoned';
      readonly importedFrom?: string;
    };
  }
  | { readonly kind: 'occurrence.transitioned'; readonly payload: TransitionPayload & { readonly entity: 'occurrence' } }
  | { readonly kind: 'run.transitioned'; readonly payload: TransitionPayload & { readonly entity: 'run' } }
  | { readonly kind: 'attempt.transitioned'; readonly payload: TransitionPayload & { readonly entity: 'attempt' } }
  | {
    readonly kind: 'occurrence.misfire_recorded';
    readonly payload: {
      readonly disposition: 'none' | 'collapsed_to_latest' | 'skipped_overlap' | 'skipped_paused' | 'skipped_invalid';
      readonly collapsedSlots: readonly string[];
    };
  }
  | {
    readonly kind: 'receipt.recorded';
    readonly payload: {
      readonly receiptRef: string;
      readonly outcome: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'ambiguous';
      readonly sideEffectClass?: 'none' | 'local_read' | 'local_write' | 'external_read' | 'external_mutation' |
        'irreversible_external_mutation';
    };
  }
  | {
    readonly kind: 'feed.snapshot';
    readonly payload: {
      readonly throughSequence: number;
      readonly state: Readonly<Record<string, unknown>>;
      readonly reason?: 'retention_compaction' | 'manual_snapshot';
    };
  }
);

export interface CovenAutomationEventPage {
  readonly stream: CovenAutomationEventStream;
  /** Exclusive concrete cursor; null means the beginning. */
  readonly after: number | null;
  readonly events: readonly CovenAutomationEvent[];
  readonly nextAfter: number | null;
  readonly checkpoint: string;
  readonly checkpointExpiresAt: string;
}

export const AUTOMATION_EVENTS_MAX_BYTES = 1_048_576;
const action = 'coven.automations.events.subscribe.v1';
const operation = 'automations.events';
const fail = (code: string): never => { throw new CovenClientError(normalizeCovenError({ code }, operation)); };
type Validator = (value: unknown) => boolean;
const oneOf = (...values: readonly string[]): Validator => (value) => typeof value === 'string' && values.includes(value);
const text = (minimum: number, maximum: number): Validator => (value) => typeof value === 'string' && value.isWellFormed() &&
  [...value].length >= minimum && [...value].length <= maximum;
const sequence: Validator = (value) => integer(value, 0);
const positive: Validator = (value) => integer(value, 1);
const timestamp: Validator = (value) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);

function shape(required: Record<string, Validator>, optional: Record<string, Validator> = {}): Validator {
  return (value) => object(value) &&
    Object.keys(value).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key)) &&
    Object.entries(required).every(([key, valid]) => Object.hasOwn(value, key) && valid(value[key])) &&
    Object.entries(optional).every(([key, valid]) => !Object.hasOwn(value, key) || valid(value[key]));
}

const identifier = (maximum: number): Validator => (value) => typeof value === 'string' &&
  value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const correlation = (minimum: number): Validator => (value) => text(minimum, 200)(value) &&
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const digest = shape({
  algorithm: oneOf('sha256'), canonicalization: oneOf('jcs-rfc8785'),
  value: (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
});
const streamShape = shape({ kind: oneOf('automation', 'occurrence', 'run'), id: text(1, 320) });
const checkpointShape: Validator = (value) => typeof value === 'string' && value.isWellFormed() &&
  value.length > 0 && Buffer.byteLength(value) <= 512;
const transition = (entity: string): Validator => shape({
  entity: oneOf(entity), from: text(1, 32), to: text(1, 32), reason: text(1, 500),
}, { fenceGeneration: positive, attemptNumber: positive, commandAdoptionKey: correlation(8) });
const definition = shape({ revision: positive }, {
  definitionDigest: digest, lifecycleState: oneOf('draft', 'paused', 'active', 'disabled', 'invalid', 'tombstoned'),
  importedFrom: text(0, 200),
});
const payloads: Record<string, Validator> = {
  'definition.created': definition, 'definition.revised': definition, 'definition.activated': definition,
  'definition.paused': definition, 'definition.disabled': definition, 'definition.invalidated': definition,
  'definition.tombstoned': definition, 'definition.imported': definition,
  'occurrence.transitioned': transition('occurrence'), 'run.transitioned': transition('run'),
  'attempt.transitioned': transition('attempt'),
  'occurrence.misfire_recorded': shape({
    disposition: oneOf('none', 'collapsed_to_latest', 'skipped_overlap', 'skipped_paused', 'skipped_invalid'),
    collapsedSlots: (value) => Array.isArray(value) && value.length <= 4_096 && value.every(timestamp),
  }),
  'receipt.recorded': shape({
    receiptRef: identifier(160), outcome: oneOf('succeeded', 'failed', 'cancelled', 'timed_out', 'ambiguous'),
  }, {
    sideEffectClass: oneOf('none', 'local_read', 'local_write', 'external_read', 'external_mutation', 'irreversible_external_mutation'),
  }),
  'feed.snapshot': shape({ throughSequence: sequence, state: object }, { reason: oneOf('retention_compaction', 'manual_snapshot') }),
};
const validEvent = shape({
  schemaVersion: oneOf('coven.automations.v1'),
  eventId: (value) => typeof value === 'string' && /^[A-Za-z0-9]{20,64}$/.test(value),
  stream: streamShape, sequence, recordedAt: timestamp, observedAt: timestamp,
  producer: shape({ component: text(1, 96), instanceId: text(1, 128) }, { implementationVersion: text(0, 64) }),
  kind: (value) => typeof value === 'string' && Object.hasOwn(payloads, value), summary: text(1, 300), payload: object,
  privacy: shape({
    classification: oneOf('public', 'operational', 'sensitive', 'restricted'),
    retention: shape({ classification: oneOf('ephemeral', 'standard', 'extended') }, { deleteAfter: timestamp }),
  }),
}, {
  causation: shape({}, { adoptionKey: correlation(8), causeEventId: text(0, 64), correlationId: correlation(1) }),
  automationId: identifier(96), occurrenceId: identifier(160), runId: identifier(160), attemptId: identifier(160), integrity: digest,
});

/** Never invoke input accessors, including nested stream fields. */
function ownData(value: unknown): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  try {
    if (!object(value)) return fail('invalid_options');
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return fail('invalid_options');
      Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true });
    }
  } catch { return fail('invalid_options'); }
  return copy;
}

export function eventsOptions(options: OperationOptions): OperationOptions {
  return ownData(options);
}

export function eventsRequest(query: CovenAutomationEventsOptions): CovenAutomationEventsRequest {
  const input = ownData(query);
  const stream = ownData(input.stream);
  if (!streamShape(stream) || Object.keys(input).some((key) => !['stream', 'after', 'checkpoint'].includes(key)) ||
    (Object.hasOwn(input, 'after') && !sequence(input.after)) ||
    (Object.hasOwn(input, 'checkpoint') && !checkpointShape(input.checkpoint)) ||
    (Object.hasOwn(input, 'after') && Object.hasOwn(input, 'checkpoint'))) return fail('invalid_options');
  return Object.freeze({
    action, stream: Object.freeze(stream),
    ...(Object.hasOwn(input, 'after') ? { after: input.after } : {}),
    ...(Object.hasOwn(input, 'checkpoint') ? { checkpoint: input.checkpoint } : {}),
  }) as unknown as CovenAutomationEventsRequest;
}

export function eventsRequestBytes(request: unknown): Buffer {
  const input = ownData(request);
  if (input.action !== action) return fail('invalid_options');
  const query = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'action'));
  return Buffer.from(JSON.stringify(eventsRequest(query as CovenAutomationEventsOptions)));
}

function freezeEventData<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeEventData(child);
    Object.freeze(value);
  }
  return value;
}

export function decodeEvents(status: number, value: Record<string, unknown>, request: CovenAutomationEventsRequest): CovenAutomationEventPage {
  const invalid = (): never => fail('invalid_response');
  if (value.ok === false && value.accepted === false && value.status === 'rejected' &&
    !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'event') && text(1, 1_000)(value.reason) && object(value.error)) {
    const error = value.error;
    const codes: Record<string, number> = { VALIDATION_FAILED: 400, NOT_FOUND: 404, CURSOR_EXPIRED: 410, STREAM_OUT_OF_ORDER: 409, INTERNAL: 500 };
    if (!shape({
      code: (entry) => typeof entry === 'string' && Object.hasOwn(codes, entry) && codes[entry] === status,
      httpStatus: (entry) => entry === status, message: (entry) => entry === value.reason, retryable: (entry) => entry === false,
    }, error.code === 'CURSOR_EXPIRED' ? { details: shape({ expiredAt: timestamp }) } : {})(error) ||
      (error.code === 'CURSOR_EXPIRED' && !Object.hasOwn(error, 'details'))) return invalid();
    throw new CovenClientError(normalizeCovenError({ code: error.code, statusCode: status, retryable: false }, operation));
  }
  if (status !== 200 || value.ok !== true || value.accepted !== true || value.status !== 'completed' ||
    Object.hasOwn(value, 'event') || Object.hasOwn(value, 'error') || Object.hasOwn(value, 'reason')) return invalid();
  const result = value.result;
  if (!shape({
    stream: streamShape, after: (entry) => entry === null || sequence(entry),
    events: (entry) => Array.isArray(entry) && entry.length <= 100,
    nextAfter: (entry) => entry === null || sequence(entry), checkpoint: checkpointShape, checkpointExpiresAt: timestamp,
  })(result) || !object(result)) return invalid();
  const page = result as unknown as CovenAutomationEventPage;
  if (page.stream.kind !== request.stream.kind || page.stream.id !== request.stream.id ||
    (request.checkpoint === undefined && page.after !== (request.after ?? null))) return invalid();
  let cursor = page.after;
  const seen = new Map<string, CovenAutomationEvent>();
  const events: CovenAutomationEvent[] = [];
  for (const event of page.events) {
    if (!validEvent(event) || !payloads[event.kind]!(event.payload) ||
      event.stream.kind !== page.stream.kind || event.stream.id !== page.stream.id) return invalid();
    const previous = seen.get(event.eventId);
    if (previous !== undefined) {
      if (!isDeepStrictEqual(previous, event)) return invalid();
      continue;
    }
    if (event.kind === 'feed.snapshot') {
      if (event.sequence !== event.payload.throughSequence || event.sequence <= (cursor ?? -1)) return invalid();
    } else if (event.sequence !== (cursor ?? -1) + 1) return invalid();
    cursor = event.sequence;
    seen.set(event.eventId, event);
    events.push(event);
  }
  if (page.nextAfter !== cursor) return invalid();
  return freezeEventData({ ...page, events });
}

/** One bounded read for each next(); no prefetch, polling, retry, or implicit rewind. */
export function subscribeEvents(
  read: (query: CovenAutomationEventsOptions, options: OperationOptions) => Promise<CovenAutomationEventPage>,
  query: CovenAutomationEventsOptions,
  options: OperationOptions,
): AsyncIterableIterator<CovenAutomationEventPage> {
  const request = eventsRequest(query);
  const safeOptions = eventsOptions(options);
  const controller = new AbortController();
  let scope: OperationScope;
  try {
    // Carry caller deadline metadata without starting an iterator-lifetime timeout.
    scope = createOperationScope({ system: 'coven', operation }, {
      signals: safeOptions.signal === undefined ? [controller.signal] : [controller.signal, safeOptions.signal],
    });
  } catch { return fail('invalid_options'); }
  const { signal } = scope.context;
  const boundedOptions = { ...safeOptions, signal };
  let nextQuery: CovenAutomationEventsOptions = {
    stream: request.stream,
    ...(request.after === undefined ? {} : { after: request.after }),
    ...(request.checkpoint === undefined ? {} : { checkpoint: request.checkpoint }),
  } as CovenAutomationEventsOptions;
  let cursor: number | null | undefined;
  let done = false;
  let pending = false;
  const finished = (): IteratorResult<CovenAutomationEventPage> => ({ done: true, value: undefined });
  return {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      if (done) return finished();
      if (pending) return fail('invalid_options');
      pending = true;
      try {
        const page = await read(nextQuery, boundedOptions);
        if (done) return finished();
        if (signal.aborted) return fail('aborted');
        if (cursor !== undefined && page.after !== cursor) return fail('invalid_response');
        cursor = page.nextAfter;
        nextQuery = { stream: request.stream, checkpoint: page.checkpoint };
        done = page.events.length === 0;
        return { done: false, value: page };
      } catch (error) {
        if (done) return finished();
        done = true;
        throw error;
      } finally {
        pending = false;
        if (done) scope.dispose();
      }
    },
    return() {
      done = true;
      controller.abort();
      scope.dispose();
      return Promise.resolve(finished());
    },
    throw(error?: unknown) {
      done = true;
      controller.abort();
      scope.dispose();
      return Promise.resolve().then(() => { throw error; });
    },
  };
}
