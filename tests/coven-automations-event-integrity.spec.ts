import { createHash } from 'node:crypto';
import { verifyEventIntegrity } from '@opencoven/coven-client';
import { expect, test } from 'vitest';
import vectors from '../packages/coven/fixtures/automations-events-v1/event-reducer-determinism.vectors.json' with { type: 'json' };

const event = vectors.cases[0]!.events[0]!;
const verify = verifyEventIntegrity;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
};
const signed = (value: object): object => ({ ...value, integrity: {
  algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: createHash('sha256').update(canonical(value)).digest('hex'),
} });

test('reports optional integrity absence without claiming authentication', () => {
  expect(verify(event)).toEqual({ schema: 'valid', integrity: 'unavailable', reasons: ['INTEGRITY_ABSENT'],
    producerAuthentication: { status: 'unverified', evidence: 'unavailable' } });
});
test('checks a present body digest and rejects tampering', () => {
  const authenticated = signed(event);
  expect(verify(authenticated)).toMatchObject({ schema: 'valid', integrity: 'valid', reasons: [] });
  expect(verify({ ...authenticated, summary: 'changed' })).toMatchObject({ integrity: 'invalid', reasons: ['INTEGRITY_MISMATCH'] });
});
test('covers nested snapshot integrity and accepts finite snapshot JSON numbers', () => {
  const snapshot = {
    ...event,
    kind: 'feed.snapshot',
    payload: { throughSequence: 0, state: { integrity: 'covered', fraction: 1.5, value: Number.MAX_SAFE_INTEGER + 1 } },
  };
  const captured = signed(snapshot);
  expect(verify(captured)).toMatchObject({ integrity: 'valid' });
  expect(verify({ ...captured, payload: { ...snapshot.payload, state: { ...snapshot.payload.state, integrity: 'changed' } } }))
    .toMatchObject({ integrity: 'invalid' });
});
test.each([null, [], { ...event, integrity: null }, { ...event, integrity: { algorithm: 'md5' } },
  { ...event, payload: { ...event.payload, entity: 'run' } }, { ...event, unsupported: true }])('rejects malformed event %#', (value) => {
  expect(verify(value)).toMatchObject({ schema: 'invalid', integrity: 'unavailable', reasons: ['INVALID_EVENT'] });
});
test('does not invoke input getters or toJSON and freezes the result', () => {
  let called = false;
  expect(verify({ ...event, get integrity() { called = true; throw new Error('secret'); } })).toMatchObject({ schema: 'invalid' });
  expect(verify({ ...event, toJSON() { called = true; return event; } })).toMatchObject({ schema: 'invalid' });
  expect(called).toBe(false);
  const result = verify(event) as { reasons: object; producerAuthentication: object };
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.reasons)).toBe(true);
  expect(Object.isFrozen(result.producerAuthentication)).toBe(true);
});
