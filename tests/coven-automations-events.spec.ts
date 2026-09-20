import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';

import {
  createCovenAutomationsClient, type CovenAutomationEvent, type CovenAutomationEventPage,
  type CovenAutomationEventStream, type CovenAutomationEventsOptions,
} from '@opencoven/coven-client';
import { createOperationScope, type OperationContext, type OperationOptions } from '@opencoven/sdk-core';
import { expect, expectTypeOf, test, vi } from 'vitest';

import vectors from '../packages/coven/fixtures/automations-events-v1/event-reducer-determinism.vectors.json' with { type: 'json' };
import provenance from '../packages/coven/fixtures/automations-events-v1/provenance.json' with { type: 'json' };
import schema from '../packages/coven/fixtures/automations-events-v1/event-envelope.schema.json' with { type: 'json' };
import type { EventEnvelope, EventPage } from '../packages/coven/fixtures/automations-events-v1/coven.automations.v1.js';

type ReadonlyContract<T> = T extends object ? { readonly [K in keyof T]: ReadonlyContract<T[K]> } : T;
type DomainEvent<T> = T extends EventEnvelope ? Omit<T, 'stream'> & { stream: CovenAutomationEventStream } : never;
type CanonicalDomainEvent = ReadonlyContract<DomainEvent<EventEnvelope>>;
type CanonicalDomainPage = ReadonlyContract<Omit<EventPage, 'stream' | 'events'> & {
  stream: CovenAutomationEventStream; events: DomainEvent<EventEnvelope>[];
}>;

const action = 'coven.automations.events.subscribe.v1';
const events = vectors.cases[0]!.events;
const stream = { kind: 'occurrence' as const, id: events[0]!.stream.id };
const checkpoint = 'ecp00000000000000000000000000000001';
const expires = '2026-09-21T00:00:00.000Z';

function page(delivery: readonly unknown[] = events, after: number | null = null, nextAfter: number | null = 2) {
  return { stream, after, events: delivery, nextAfter, checkpoint, checkpointExpiresAt: expires };
}

function envelope(result: unknown = page()) {
  return { ok: true, accepted: true, action, status: 'completed', result };
}

function setup(value: unknown = envelope(), status = 200) {
  const transport = {
    capabilities: vi.fn<(context: OperationContext) => Promise<{ status: number; body: Buffer<ArrayBuffer> }>>()
      .mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({
      capabilities: [{
        id: 'coven.automations', label: 'Automations', adapter: 'coven-daemon', status: 'available',
        policy: 'allow', actions: [action], variantNegotiation: {
          version: 1, contractProfile: 'coven.automations.v1', description: 'Negotiation',
          supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
          experimental: [], refused: [], negotiationRules: [],
        },
      }],
    })) }),
    readDefinitions: vi.fn<(request: unknown, context: OperationContext) => Promise<{ status: number; body: Buffer<ArrayBuffer> }>>()
      .mockResolvedValue({
      status, body: Buffer.from(JSON.stringify(value)),
      }),
  };
  return { transport, client: createCovenAutomationsClient({ transport }) };
}

test('pins the exact producer schemas and duplicate-delivery fixture bytes', () => {
  expect(provenance.commit).toBe('aa28d994965a83c0dfba8eaca071e182d605fed1');
  for (const [file, source] of Object.entries(provenance.files)) {
    const bytes = readFileSync(new URL(`../packages/coven/fixtures/automations-events-v1/${file}`, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
  }
});

test('public event and page types match the pinned canonical types in both directions for supported domain streams', () => {
  expectTypeOf<[CovenAutomationEvent] extends [CanonicalDomainEvent] ? true : false>().toEqualTypeOf<true>();
  expectTypeOf<[CanonicalDomainEvent] extends [CovenAutomationEvent] ? true : false>().toEqualTypeOf<true>();
  expectTypeOf<[CovenAutomationEventPage] extends [CanonicalDomainPage] ? true : false>().toEqualTypeOf<true>();
  expectTypeOf<[CanonicalDomainPage] extends [CovenAutomationEventPage] ? true : false>().toEqualTypeOf<true>();
});

test('reads a bounded canonical page through capability negotiation and the existing transport', async () => {
  const { client, transport } = setup();
  expect(await client.events({ stream })).toEqual(page());
  expect(transport.readDefinitions).toHaveBeenCalledTimes(1);
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action, stream });
  expect(transport.readDefinitions.mock.calls[0]?.[1]).toBe(transport.capabilities.mock.calls[0]?.[0]);
  expect(Object.isFrozen(transport.readDefinitions.mock.calls[0]?.[0])).toBe(true);
});

test.each([
  {}, null, { stream: { kind: 'feed', id: 'all' } }, { stream: { kind: 'unknown', id: 'a' } },
  { stream: { ...stream, id: '' } }, { stream: { ...stream, id: 'a'.repeat(321) } },
  { stream: { ...stream, extra: true } }, { stream, after: -1 }, { stream, after: 0.5 },
  { stream, after: Number.MAX_SAFE_INTEGER + 1 }, { stream, after: null },
  { stream, checkpoint: '' }, { stream, checkpoint: 'é'.repeat(257) }, { stream, checkpoint: '\ud800' },
  { stream, checkpoint, after: 0 }, { stream, limit: 100 }, { stream, from: expires },
  { stream, [Symbol('extra')]: true }, { stream, checkpoint: undefined },
])('rejects unsupported or malformed options before transport %#', async (query) => {
  const { client, transport } = setup();
  await expect(client.events(query as CovenAutomationEventsOptions)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test('snapshots own request fields and refuses accessors without invoking them', async () => {
  const { client, transport } = setup();
  const getter = vi.fn(() => stream);
  await expect(client.events(Object.defineProperty({}, 'stream', { get: getter }) as CovenAutomationEventsOptions))
    .rejects.toMatchObject({ code: 'invalid_options' });
  expect(getter).not.toHaveBeenCalled();
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test('canonical duplicate delivery is ignored without changing the exclusive cursor', async () => {
  const duplicate = vectors.cases[0]!.duplicateIndex;
  const delivery = [...events.slice(0, duplicate + 1), events[duplicate], ...events.slice(duplicate + 1)];
  expect(await setup(envelope(page(delivery))).client.events({ stream })).toEqual(page());
});

test('refuses contradictory contents for a duplicate event ID', async () => {
  const delivery = [events[0], { ...events[0], summary: 'changed meaning' }, events[1], events[2]];
  await expect(setup(envelope(page(delivery))).client.events({ stream })).rejects.toMatchObject({ code: 'invalid_response' });
});

test('accepts each canonical kind only with its matching payload', async () => {
  const digest = { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: 'a'.repeat(64) };
  const variants = [
    ...['created', 'revised', 'activated', 'paused', 'disabled', 'invalidated', 'tombstoned', 'imported'].map((suffix) => ({
      kind: `definition.${suffix}`,
      payload: { revision: 1, definitionDigest: digest, lifecycleState: 'active', importedFrom: 'legacy' },
    })),
    ...['occurrence', 'run', 'attempt'].map((entity) => ({ kind: `${entity}.transitioned`, payload: {
      entity, from: 'none', to: 'running', reason: 'test', fenceGeneration: 1, attemptNumber: 1, commandAdoptionKey: 'adoption-1',
    } })),
    { kind: 'occurrence.misfire_recorded', payload: { disposition: 'collapsed_to_latest', collapsedSlots: [expires] } },
    { kind: 'receipt.recorded', payload: { receiptRef: 'receipt-1', outcome: 'failed', sideEffectClass: 'none' } },
    { kind: 'feed.snapshot', payload: { throughSequence: 0, state: { entity: 'occurrence' }, reason: 'retention_compaction' } },
  ];
  expect(variants.map(({ kind }) => kind).sort()).toEqual([...schema.$defs.eventKind.enum].sort());
  for (const variant of variants) {
    const event = {
      ...events[0], ...variant, integrity: digest,
      producer: { ...events[0]!.producer, implementationVersion: '0.4.4' },
      causation: { adoptionKey: 'adoption-1', causeEventId: 'cause', correlationId: 'correlation' },
      runId: 'run-1', attemptId: 'attempt-1',
      privacy: { classification: 'sensitive', retention: { classification: 'ephemeral', deleteAfter: expires } },
    };
    expect(Object.keys(event).sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.required.every((key) => Object.hasOwn(event, key))).toBe(true);
    expect(await setup(envelope(page([event], null, 0))).client.events({ stream })).toEqual(page([event], null, 0));
    const payload = { ...variant.payload, unknown: true };
    await expect(setup(envelope(page([{ ...event, payload }], null, 0))).client.events({ stream }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  }
});

test('preserves explicit compaction snapshots but rejects stale or inconsistent snapshot cursors', async () => {
  const event = { ...events[0], kind: 'feed.snapshot', sequence: 5, payload: { throughSequence: 5, state: { count: 3 } } };
  expect(await setup(envelope(page([event], null, 5))).client.events({ stream })).toEqual(page([event], null, 5));
  for (const result of [page([event], 5, 5), page([{ ...event, sequence: 4 }], null, 4)]) {
    await expect(setup(envelope(result)).client.events({ stream, checkpoint })).rejects.toMatchObject({ code: 'invalid_response' });
  }
});

test.each(Object.keys(events[0]!))('refuses missing or null canonical event field %s', async (key) => {
  const omitted: Record<string, unknown> = { ...events[0] };
  delete omitted[key];
  // Correlation IDs are optional in the envelope; everything else here is required.
  if (key !== 'automationId' && key !== 'occurrenceId') {
    await expect(setup(envelope(page([omitted], null, 0))).client.events({ stream })).rejects.toMatchObject({ code: 'invalid_response' });
  }
  await expect(setup(envelope(page([{ ...events[0], [key]: null }], null, 0))).client.events({ stream }))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each(['VALIDATION_FAILED', 'NOT_FOUND', 'STREAM_OUT_OF_ORDER', 'INTERNAL'])(
  'preserves sanitized producer %s without retry or payload leakage', async (code) => {
    const statuses: Record<string, number> = { VALIDATION_FAILED: 400, NOT_FOUND: 404, STREAM_OUT_OF_ORDER: 409, INTERNAL: 500 };
    const status = statuses[code]!;
    const error = { code, httpStatus: status, message: '/private/secret', retryable: false };
    const value = { ok: false, accepted: false, action, status: 'rejected', reason: error.message, error };
    const { client, transport } = setup(value, status);
    await expect(client.events({ stream })).rejects.toMatchObject({ code, statusCode: status, retryable: false });
    await client.events({ stream }).catch((error: unknown) => { expect(JSON.stringify(error)).not.toContain('secret'); });
    expect(transport.readDefinitions).toHaveBeenCalledTimes(2);
    for (const wrong of [
      { ...value, reason: 'different' }, { ...value, result: {} }, { ...value, event: {} },
      { ...value, error: { ...error, retryable: true } }, { ...value, error: { ...error, details: {} } },
    ]) {
      await expect(setup(wrong, status).client.events({ stream })).rejects.toMatchObject({ code: 'invalid_response' });
    }
    await expect(setup(value, 200).client.events({ stream })).rejects.toMatchObject({ code: 'invalid_response' });
  },
);

test('requires exact capability/transport support and preserves defaults and observer context', async () => {
  const { transport } = setup();
  const observer = { onEvent: vi.fn(), onObserverError: vi.fn() };
  const client = createCovenAutomationsClient({ transport, operation: { timeoutMs: 1_000, observer } });
  await client.events({ stream });
  expect(observer.onEvent).toHaveBeenCalled();
  expect(transport.readDefinitions.mock.calls[0]?.[1].deadline).toBeTypeOf('number');
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from('{"capabilities":[]}') });
  await expect(client.events({ stream })).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).toHaveBeenCalledOnce();
  const unsupported = createCovenAutomationsClient({ transport: { capabilities: transport.capabilities } });
  await expect(unsupported.events({ stream })).rejects.toMatchObject({ code: 'unsupported_operation' });
});

test('snapshots the caller query and bounds concurrent next calls without prefetch', async () => {
  const { client, transport } = setup();
  const query = { stream: { ...stream } };
  const iterator = client.subscribe(query);
  expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
  query.stream.id = 'changed';
  const pending = iterator.next();
  await expect(iterator.next()).rejects.toMatchObject({ code: 'invalid_options' });
  expect((await pending).done).toBe(false);
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action, stream });
  await iterator.return?.();
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
  expect(transport.readDefinitions).toHaveBeenCalledOnce();
});

test('rejects expiry during subscription and never silently rewinds', async () => {
  const { client, transport } = setup();
  const iterator = client.subscribe({ stream });
  await iterator.next();
  const error = { code: 'CURSOR_EXPIRED', httpStatus: 410, message: 'expired', retryable: false, details: { expiredAt: expires } };
  transport.readDefinitions.mockResolvedValue({ status: 410, body: Buffer.from(JSON.stringify({
    ok: false, accepted: false, action, status: 'rejected', reason: 'expired', error,
  })) });
  await expect(iterator.next()).rejects.toMatchObject({ code: 'CURSOR_EXPIRED' });
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
  expect(transport.readDefinitions).toHaveBeenCalledTimes(2);
});

test.each([
  page([events[1], events[0], events[2]]), page([events[0], events[2]]),
  page([events[1]], 2, 1), page(events, null, 3), page([], 2, 3),
  page([{ ...events[0], stream: { ...stream, id: 'other' } }], null, 0),
  page([{ ...events[0], kind: 'receipt.recorded' }], null, 0),
  page([{ ...events[0], sequence: 0.5 }], null, 0),
  page([{ ...events[0], eventId: 'short' }], null, 0),
  page([{ ...events[0], unknown: true }], null, 0),
  page([events[0], { ...events[0], sequence: 1 }], null, 1),
  { ...page(), stream: { ...stream, id: 'other' } }, { ...page(), checkpoint: '' },
  { ...page(), checkpointExpiresAt: 'tomorrow' }, { ...page(), extra: true },
  page(Array.from({ length: 101 }, () => events[0])),
])('rejects malformed, contradictory, oversized, or out-of-order pages %#', async (result) => {
  await expect(setup(envelope(result)).client.events({ stream })).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([Buffer.from('{"ok":true,"ok":true}'), Buffer.from([0xff]), Buffer.alloc(1_048_577)])(
  'rejects malformed or oversized wire bytes %#', async (body) => {
    const { client, transport } = setup();
    transport.readDefinitions.mockResolvedValue({ status: 200, body });
    await expect(client.events({ stream })).rejects.toMatchObject({ code: 'invalid_response' });
  },
);

test('checks the concrete exclusive after cursor and uses checkpoints without an after field', async () => {
  const { client, transport } = setup(envelope(page([events[2]], 1)));
  expect(await client.events({ stream, after: 1 })).toEqual(page([events[2]], 1));
  await expect(client.events({ stream, after: 0 })).rejects.toMatchObject({ code: 'invalid_response' });
  await client.events({ stream, checkpoint });
  expect(transport.readDefinitions.mock.calls.at(-1)?.[0]).toEqual({ action, stream, checkpoint });
});

test('surfaces typed expired checkpoints and never resets or retries them', async () => {
  const error = { code: 'CURSOR_EXPIRED', httpStatus: 410, message: 'expired', retryable: false, details: { expiredAt: expires } };
  const { client, transport } = setup({ ok: false, accepted: false, action, status: 'rejected', reason: 'expired', error }, 410);
  await expect(client.events({ stream, checkpoint })).rejects.toMatchObject({ code: 'CURSOR_EXPIRED', statusCode: 410 });
  expect(transport.readDefinitions).toHaveBeenCalledTimes(1);
});

test('subscription is lazy, yields bounded pages and resumes only on demand', async () => {
  const { client, transport } = setup();
  const iterator = client.subscribe({ stream });
  expect(transport.capabilities).not.toHaveBeenCalled();
  expect(await iterator.next()).toEqual({ done: false, value: page() });
  expect(transport.readDefinitions).toHaveBeenCalledTimes(1);
  transport.readDefinitions.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(envelope(page([], 2, 2)))) });
  expect(await iterator.next()).toEqual({ done: false, value: page([], 2, 2) });
  expect(transport.readDefinitions.mock.calls.at(-1)?.[0]).toEqual({ action, stream, checkpoint });
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
  expect(transport.readDefinitions).toHaveBeenCalledTimes(2);
});

test('subscription rejects a rewound checkpoint page before yielding and closes after failure', async () => {
  const { client, transport } = setup();
  const iterator = client.subscribe({ stream });
  await iterator.next();
  await expect(iterator.next()).rejects.toMatchObject({ code: 'invalid_response' });
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
  expect(transport.readDefinitions).toHaveBeenCalledTimes(2);
});

test('return cancels in-flight work, prevents late yield, and does not cancel another iterator', async () => {
  const { client, transport } = setup();
  let resolve: ((value: { status: number; body: Buffer<ArrayBuffer> }) => void) | undefined;
  transport.readDefinitions.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const first = client.subscribe({ stream });
  const second = client.subscribe({ stream });
  const pending = first.next();
  await vi.waitFor(() => expect(resolve).toBeDefined());
  const signal = transport.readDefinitions.mock.calls[0]![1].signal;
  expect(await first.return?.()).toEqual({ done: true, value: undefined });
  expect(signal.aborted).toBe(true);
  expect(await pending).toEqual({ done: true, value: undefined });
  resolve!({ status: 200, body: Buffer.from(JSON.stringify(envelope())) });
  expect(await first.next()).toEqual({ done: true, value: undefined });
  expect((await second.next()).done).toBe(false);
});

test('abort and timeout close a non-cooperative subscription without retry or late yield', async () => {
  for (const abort of [true, false]) {
    const { client, transport } = setup();
    transport.readDefinitions.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const iterator = client.subscribe({ stream }, { signal: controller.signal, timeoutMs: abort ? 5_000 : 10 });
    const rejected = expect(iterator.next()).rejects.toMatchObject({ code: abort ? 'aborted' : 'timeout' });
    if (abort) controller.abort();
    await rejected;
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(transport.readDefinitions.mock.calls.length).toBeLessThanOrEqual(1);
  }
});

test('throw closes and aborts the iterator while preserving the caller error', async () => {
  const { client, transport } = setup();
  transport.readDefinitions.mockImplementation(() => new Promise(() => {}));
  const iterator = client.subscribe({ stream });
  const pending = iterator.next();
  await vi.waitFor(() => expect(transport.readDefinitions).toHaveBeenCalledOnce());
  const error = new Error('caller stopped processing');
  expect(typeof iterator.throw).toBe('function');
  await expect(iterator.throw!(error)).rejects.toBe(error);
  expect(transport.readDefinitions.mock.calls[0]?.[1].signal.aborted).toBe(true);
  expect(await pending).toEqual({ done: true, value: undefined });
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
});

test.each(['return', 'abort', 'timeout'] as const)(
  'a capability response arriving after %s cannot start an action', async (stop) => {
    const { client, transport } = setup();
    const response = await transport.capabilities({ signal: new AbortController().signal, deadline: undefined });
    let resolve: (() => void) | undefined;
    transport.capabilities.mockImplementation(() => new Promise((done) => { resolve = () => done(response); }));
    const controller = new AbortController();
    const iterator = client.subscribe({ stream }, { signal: controller.signal, timeoutMs: stop === 'timeout' ? 10 : 5_000 });
    const pending = iterator.next();
    const settled = stop === 'return' ? expect(pending).resolves.toEqual({ done: true, value: undefined })
      : expect(pending).rejects.toMatchObject({ code: stop === 'abort' ? 'aborted' : 'timeout' });
    await vi.waitFor(() => expect(resolve).toBeDefined(), { interval: 1 });
    if (stop === 'return') await iterator.return?.();
    if (stop === 'abort') controller.abort();
    await settled;
    resolve!();
    await new Promise<void>((done) => { setImmediate(done); });
    expect(transport.readDefinitions).not.toHaveBeenCalled();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  },
);

test('normalizes revoked query/stream proxies without transport I/O', async () => {
  const { client, transport } = setup();
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const query of [revoked.proxy, { stream: revoked.proxy }]) {
    await expect(client.events(query as CovenAutomationEventsOptions)).rejects.toMatchObject({ name: 'CovenClientError', code: 'invalid_options' });
  }
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test('rejects operation option accessors without invoking them or leaking their errors', async () => {
  const { client, transport } = setup();
  for (const key of ['signal', 'timeoutMs', 'observer']) {
    const getter = vi.fn(() => { throw new Error('private-marker'); });
    const options = Object.defineProperty({}, key, { get: getter }) as OperationOptions;
    expect(() => client.subscribe({ stream }, options)).toThrow(expect.objectContaining({ name: 'CovenClientError', code: 'invalid_options' }));
    await expect(client.events({ stream }, options)).rejects.toMatchObject({ name: 'CovenClientError', code: 'invalid_options' });
    expect(getter).not.toHaveBeenCalled();
  }
  expect(() => client.subscribe({ stream }, { signal: {} as AbortSignal }))
    .toThrow(expect.objectContaining({ name: 'CovenClientError', code: 'invalid_options' }));
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test('returns a deeply immutable event page including the owned events array', async () => {
  const value = await setup().client.events({ stream });
  for (const object of [value, value.stream, value.events, value.events[0], value.events[0]?.payload,
    value.events[0]?.producer, value.events[0]?.privacy, value.events[0]?.privacy.retention]) {
    expect(Object.isFrozen(object)).toBe(true);
  }
  expect(Reflect.set(value, 'after', 123)).toBe(false);
  expect(Reflect.set(value.events, 'length', 0)).toBe(false);
  expect(Reflect.set(value.events[0]!, 'newField', 'changed')).toBe(false);
  expect(value).toEqual(page());
});

test('a synchronous action adapter cannot yield a page after the monotonic deadline while timers are blocked', async () => {
  const { client, transport } = setup();
  transport.readDefinitions.mockImplementation((request, context) => {
    expect(request).toEqual({ action, stream });
    const until = context.deadline! + 10;
    while (performance.now() < until) { /* Block timers to exercise the monotonic deadline guard. */ }
    expect(context.signal.aborted).toBe(false);
    return Promise.resolve({ status: 200, body: Buffer.from(JSON.stringify(envelope())) });
  });
  const iterator = client.subscribe({ stream }, { timeoutMs: 10 });
  await expect(iterator.next()).rejects.toMatchObject({ code: 'timeout' });
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
  expect(transport.readDefinitions).toHaveBeenCalledOnce();
});

test('subscription preserves a caller scope deadline when the action adapter blocks its timer', async () => {
  const { client, transport } = setup();
  const caller = createOperationScope({ system: 'coven', operation: 'caller' }, { timeoutMs: 20 });
  const iterator = client.subscribe({ stream }, { signal: caller.context.signal, timeoutMs: 1_000 });
  transport.readDefinitions.mockImplementation((_request, context) => {
    const until = caller.context.deadline! + 10;
    while (performance.now() < until) { /* Keep the caller timer from delivering cancellation. */ }
    expect(context.signal.aborted).toBe(false);
    return Promise.resolve({ status: 200, body: Buffer.from(JSON.stringify(envelope())) });
  });
  try {
    await expect(iterator.next()).rejects.toMatchObject({ code: 'timeout' });
    expect(transport.readDefinitions.mock.calls[0]?.[1].deadline).toBe(caller.context.deadline);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(getEventListeners(caller.context.signal, 'abort')).toHaveLength(0);
  } finally {
    await iterator.return?.();
    caller.dispose();
  }
});

test.each(['empty', 'failure', 'return', 'throw', 'abort'] as const)(
  'subscription removes caller abort listeners after %s', async (stop) => {
    const { client, transport } = setup(stop === 'empty' ? envelope(page([], null, null)) : envelope());
    const controller = new AbortController();
    const iterator = client.subscribe({ stream }, { signal: controller.signal });
    if (stop === 'failure') transport.readDefinitions.mockRejectedValue(new Error('adapter failed'));
    if (stop === 'return') await iterator.return?.();
    else if (stop === 'throw') await expect(iterator.throw?.(new Error('caller stopped'))).rejects.toThrow('caller stopped');
    else if (stop === 'abort') {
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({ code: 'aborted' });
    } else if (stop === 'failure') await expect(iterator.next()).rejects.toThrow();
    else expect((await iterator.next()).value).toEqual(page([], null, null));
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  },
);

test('subscription timeout starts separately for each requested page', async () => {
  vi.useFakeTimers();
  const { client, transport } = setup();
  const iterator = client.subscribe({ stream }, { timeoutMs: 10 });
  try {
    await vi.advanceTimersByTimeAsync(20);
    expect((await iterator.next()).value).toEqual(page());
    transport.readDefinitions.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(envelope(page([], 2, 2)))) });
    await vi.advanceTimersByTimeAsync(20);
    expect((await iterator.next()).value).toEqual(page([], 2, 2));
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await iterator.return?.();
    vi.useRealTimers();
  }
});
