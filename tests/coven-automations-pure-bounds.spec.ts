import { computeDefinitionDigest, reduceAutomationEvents, verifyEventIntegrity } from '@opencoven/coven-client';
import { expect, test } from 'vitest';
import vectors from '../packages/coven/fixtures/automations-events-v1/event-reducer-determinism.vectors.json' with { type: 'json' };
import definitions from '../packages/coven/fixtures/automations-pure-v1/test-vectors.json' with { type: 'json' };
import { snapshotAutomationJson } from '../packages/coven/src/automations-canonical-json.js';

const event = vectors.cases[0]!.events[0]!;
const snapshot = (state: unknown, sequence = 0): unknown => ({ ...event, kind: 'feed.snapshot', sequence,
  payload: { throughSequence: sequence, state } });
const invalid = (value: unknown): void => { expect(reduceAutomationEvents([snapshot(value)])).toEqual({ status: 'invalid', reason: 'INVALID_EVENTS' }); };

test('applies cumulative properties and string budgets across duplicate-heavy batches', () => {
  expect(reduceAutomationEvents(Array(100).fill(event))).toMatchObject({ status: 'projected' });
  expect(reduceAutomationEvents(Array(1_000).fill(event))).toEqual({ status: 'invalid', reason: 'INVALID_EVENTS' });
  invalid({ value: 'x'.repeat(262_144) });
  invalid(Object.fromEntries(Array.from({ length: 8_193 }, (_, index) => [String(index), 0])));
  expect(reduceAutomationEvents([snapshot({ value: 'x'.repeat(200_000) })])).toMatchObject({ status: 'projected' });
});
test('bounds arrays before enumeration and total containers independently of byte size', () => {
  let enumerated = false;
  invalid({ array: new Proxy(new Array(4_097), { ownKeys() { enumerated = true; throw new Error('secret'); } }) });
  expect(enumerated).toBe(false);
  invalid({ array: Array.from({ length: 4_096 }, () => ({})) });
  expect(reduceAutomationEvents([snapshot({ array: Array(4_096).fill(null) })])).toMatchObject({ status: 'projected' });
});
test('refuses excessive depth, cycles, sparse arrays, host prototypes and non-JSON values', () => {
  let deep: unknown = {};
  for (let index = 0; index < 18; index++) deep = { deep };
  invalid(deep);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [cycle, { a: new Array(2) }, { a: new Date() }, { a: NaN }, { a: -Infinity },
    { a: Number.MAX_SAFE_INTEGER + 1 }, { a: undefined }, { a: () => null }, { a: '\ud800' },
    { '\ud800': 1 }, { [Symbol('secret')]: 1 }]) invalid(value);
});
test('copies repeated aliases without losing aggregate bounds and handles hostile proxies', () => {
  const alias = { integrity: 'nested', ratio: 0.5 };
  expect(reduceAutomationEvents([snapshot({ a: alias, b: alias })])).toMatchObject({ status: 'projected', state: { a: alias, b: alias } });
  let gets = 0;
  const proxy = new Proxy({ ...event }, { get() { gets++; throw new Error('secret'); } });
  expect(verifyEventIntegrity(proxy).schema).toBe('valid');
  expect(gets).toBe(0);
  invalid(new Proxy({}, { ownKeys() { throw new Error('secret'); } }));
  let keys = 0;
  invalid(new Proxy({ a: 1, b: 2 }, { ownKeys() { return keys++ === 0 ? ['a'] : ['b']; } }));
});
test('JCS numeric mode shares all owned-snapshot boundaries while receipt defaults stay strict', () => {
  expect(snapshotAutomationJson(0.5)).toBeUndefined();
  expect(snapshotAutomationJson(0.5, 'jcs')).toBe(0.5);
  const original = definitions.fixtures['definition.golden'];
  for (const value of [null, [], { ...original, get extensions() { throw new Error('secret'); } }]) {
    expect(computeDefinitionDigest(value)).toEqual({ status: 'invalid', reason: 'INVALID_DEFINITION' });
  }
});
test('holds the maximum safe cursor without wrapping and honors only valid eventWindow integers', () => {
  const max = Number.MAX_SAFE_INTEGER;
  expect(reduceAutomationEvents([snapshot({}, max)])).toMatchObject({ status: 'projected', cursor: max });
  expect(reduceAutomationEvents([snapshot({}, max), { ...event, sequence: 0, eventId: 'distinct00000000000000000' }]))
    .toEqual({ status: 'invalid', reason: 'STREAM_OUT_OF_ORDER' });
  const later = { ...event, eventId: 'laterevent000000000000000', sequence: 2 };
  for (const firstSequence of [-1, 1.5, '0', null]) {
    expect(reduceAutomationEvents([snapshot({ eventWindow: { firstSequence } }, 1), later]))
      .toMatchObject({ status: 'projected', state: { eventWindow: { firstSequence: 2, lastSequence: 2 } } });
  }
});
test('projects optional definition fields and every lifecycle event without inferring authority', () => {
  const digest = { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: 'a'.repeat(64) };
  for (const kind of ['created', 'revised', 'activated', 'paused', 'disabled', 'invalidated', 'tombstoned', 'imported']) {
    const input = { ...event, kind: `definition.${kind}`, payload: { revision: 1, definitionDigest: digest } };
    expect(reduceAutomationEvents([input])).toMatchObject({ status: 'projected', state: { entity: 'definition', revision: 1, definitionDigest: digest } });
    const result = reduceAutomationEvents([input]);
    if (result.status === 'projected') expect(result.state).not.toHaveProperty('state');
  }
});
test('checks every pinned occurrence terminal state without inventing initial or adjacency edges', () => {
  for (const from of ['succeeded', 'failed', 'cancelled', 'timed_out', 'skipped', 'superseded']) {
    const tail = { ...event, eventId: 'laterevent000000000000000', sequence: 2, payload: { ...event.payload, from, to: 'running' } };
    expect(reduceAutomationEvents([snapshot({ entity: 'occurrence', state: from }, 1), tail]))
      .toEqual({ status: 'invalid', reason: 'OCCURRENCE_TERMINAL_REGRESSION' });
  }
});
