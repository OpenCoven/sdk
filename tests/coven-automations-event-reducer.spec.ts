import { createHash } from 'node:crypto';
import { reduceAutomationEvents } from '@opencoven/coven-client';
import { expect, test } from 'vitest';
import vectors from '../packages/coven/fixtures/automations-events-v1/event-reducer-determinism.vectors.json' with { type: 'json' };

const vector = vectors.cases[0]!;
const events = vector.events;
const reduce = reduceAutomationEvents;
const event = (sequence: number, kind: string, payload: object): object => ({
  ...events[0], eventId: `eventid${String(sequence).padStart(20, '0')}`, sequence, kind, payload,
});

test('matches the canonical duplicate and state-digest vector', () => {
  const result = reduce(events);
  expect(result).toMatchObject({ status: 'projected', cursor: 2, authority: 'unverified', occurrenceContinuity: 'unavailable',
    state: { entity: 'occurrence', state: 'claimed', eventWindow: { firstSequence: 0, lastSequence: 2 } },
    stateDigest: vector.expectedStateDigest });
  const duplicate = [...events]; duplicate.splice(vector.duplicateIndex, 0, events[vector.duplicateIndex]!);
  expect(reduce(duplicate)).toEqual(result);
});
test.each([
  ['planned', 'eligible'],
  ['none', 'planned'],
])('sequence zero %s to %s has no known prior occurrence state', (from, to) => {
  const result = reduce([event(0, 'occurrence.transitioned', {
    entity: 'occurrence', from, to, reason: 'producer_transition',
  })]);
  expect(result).toMatchObject({ status: 'projected', cursor: 0, occurrenceContinuity: 'unavailable',
    state: { entity: 'occurrence', state: to, eventWindow: { firstSequence: 0, lastSequence: 0 } } });
});
test('starts empty without synthesizing a cursor or entity', () => {
  expect(reduce([])).toMatchObject({ status: 'projected', stream: null, cursor: null, state: null,
    stateDigest: `sha256:${createHash('sha256').update('null').digest('hex')}`, occurrenceContinuity: 'unavailable' });
});
test('rejects a changed duplicate, stream mixing, sequence gaps and regressions', () => {
  expect(reduce([events[0], { ...events[0], summary: 'changed' }])).toEqual({ status: 'invalid', reason: 'EVENT_ID_CONFLICT' });
  expect(reduce([events[0], { ...events[1], stream: { kind: 'occurrence', id: 'different' } }]))
    .toEqual({ status: 'invalid', reason: 'STREAM_MISMATCH' });
  expect(reduce([events[1]])).toEqual({ status: 'invalid', reason: 'STREAM_OUT_OF_ORDER' });
  expect(reduce([events[0], events[2]])).toEqual({ status: 'invalid', reason: 'STREAM_OUT_OF_ORDER' });
  expect(reduce([...events, { ...events[0], eventId: 'distincteventidentifier0000' }]))
    .toEqual({ status: 'invalid', reason: 'STREAM_OUT_OF_ORDER' });
});
test('snapshot plus strictly later tail matches full reduction', () => {
  const snapshot = event(1, 'feed.snapshot', { throughSequence: 1, state: {
    entity: 'occurrence', state: 'eligible', eventWindow: { firstSequence: 0, lastSequence: 1 },
  } });
  const compacted = reduce([snapshot, events[2]]);
  const full = reduce(events);
  if (compacted.status !== 'projected' || full.status !== 'projected') throw new Error('Expected projected batches');
  expect(compacted.state).toEqual(full.state);
  expect(compacted.stateDigest).toBe(full.stateDigest);
  expect(compacted.cursor).toBe(full.cursor);
  expect(compacted.stream).toEqual(full.stream);
  expect(compacted.occurrenceContinuity).toBe('checked');
  expect(full.occurrenceContinuity).toBe('unavailable');
  expect(reduce([...events, snapshot])).toEqual({ status: 'invalid', reason: 'STREAM_OUT_OF_ORDER' });
  expect(reduce([event(1, 'feed.snapshot', { throughSequence: 2, state: {} })]))
    .toEqual({ status: 'invalid', reason: 'STREAM_OUT_OF_ORDER' });
});
test('folds every payload family by replacement without inventing a state machine', () => {
  for (const [kind, payload, state] of [
    ['definition.revised', { revision: 2, lifecycleState: 'active' }, { entity: 'definition', revision: 2, state: 'active' }],
    ['run.transitioned', { entity: 'run', from: 'accepted', to: 'running', reason: 'started' }, { entity: 'run', state: 'running' }],
    ['attempt.transitioned', { entity: 'attempt', from: 'adopted', to: 'started', reason: 'started' }, { entity: 'attempt', state: 'started' }],
    ['occurrence.misfire_recorded', { disposition: 'none', collapsedSlots: [] }, { entity: 'occurrence', misfire: { disposition: 'none', collapsedSlots: [] } }],
    ['receipt.recorded', { receiptRef: 'receipt-1', outcome: 'succeeded' }, { entity: 'receipt', receipt: { receiptRef: 'receipt-1', outcome: 'succeeded' } }],
  ] as const) expect(reduce([event(0, kind, payload)])).toMatchObject({ status: 'projected',
    state: { ...state, eventWindow: { firstSequence: 0, lastSequence: 0 } } });
});
test('refuses known occurrence discontinuity and terminal departure but allows reference skipped intermediates', () => {
  expect(reduce([events[0], event(1, 'occurrence.transitioned', { entity: 'occurrence', from: 'eligible', to: 'claimed', reason: 'claim' })]))
    .toEqual({ status: 'invalid', reason: 'OCCURRENCE_STATE_MISMATCH' });
  const terminal = event(5, 'feed.snapshot', { throughSequence: 5, state: { entity: 'occurrence', state: 'succeeded' } });
  expect(reduce([terminal, event(6, 'occurrence.transitioned', { entity: 'occurrence', from: 'succeeded', to: 'running', reason: 'runtime_started' })]))
    .toEqual({ status: 'invalid', reason: 'OCCURRENCE_TERMINAL_REGRESSION' });
  expect(reduce([events[0], event(1, 'occurrence.transitioned', { entity: 'occurrence', from: 'planned', to: 'claimed', reason: 'claim' })]))
    .toMatchObject({ status: 'projected' });
});
test('opaque snapshots keep nested integrity and make continuity unavailable', () => {
  const snapshot = event(1, 'feed.snapshot', { throughSequence: 1, state: { integrity: 'covered' } });
  expect(reduce([snapshot])).toMatchObject({ state: { integrity: 'covered' },
    stateDigest: `sha256:${createHash('sha256').update('{"integrity":"covered"}').digest('hex')}`, occurrenceContinuity: 'unavailable' });
  expect(reduce([snapshot, events[2]])).toMatchObject({ status: 'projected', occurrenceContinuity: 'unavailable' });
});
test('refuses invalid integrity and malformed batches without partial state', () => {
  expect(reduce([events[0], { ...events[1], integrity: { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: '0'.repeat(64) } }]))
    .toEqual({ status: 'invalid', reason: 'EVENT_INTEGRITY_MISMATCH' });
  for (const input of [null, {}, [null], new Array(4097).fill(events[0])])
    expect(reduce(input)).toEqual({ status: 'invalid', reason: 'INVALID_EVENTS' });
});
test('owns frozen results while leaving source events mutable', () => {
  const input = structuredClone(events);
  const result = reduce(input);
  if (result.status !== 'projected') throw new Error('Expected a projected batch');
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.state)).toBe(true);
  expect(Object.isFrozen((result.state as Record<string, unknown>).eventWindow)).toBe(true);
  expect(Object.isFrozen(result.stream)).toBe(true);
  expect(Object.isFrozen(input)).toBe(false);
  input[2]!.payload.to = 'changed';
  expect(result.state).toMatchObject({ state: 'claimed' });
});
