import * as managed from '@opencoven/cave-client/managed';
import { expect, test } from 'vitest';

const contract = {
  id: 'cody',
  present: { soul: true, identity: true, ward: false, memory: false },
  identity: { name: 'Cody' },
  report: { specVersion: '0.1.0', pass: true, properties: [], violations: [], warnings: [] },
};
const envelope = {
  apiVersion: '1.0', minimumClientVersion: '0.0.1',
  capabilities: ['familiars'], operations: ['familiars.contract.read'],
  data: { contract },
};

test('converts a canonical client-v1 contract envelope into the managed response', () => {
  expect(managed.canonicalFamiliarContractData(envelope)).toEqual({ ok: true, ...contract });
});

const analytics = {
  generatedAt: '2026-09-14T00:00:00.000Z',
  windows: { '7d': {
    attempts: 1, completed: 1, failed: 0, cancelled: 0,
    successRate: 1, toolCalls: 0, toolFailures: 0, models: [], harnesses: [], coverage: {},
    days: [{ date: '2026-09-14', completed: 1, failed: 0, cancelled: 0 }],
  } },
  recentAttempts: [], backfill: { state: 'complete', imported: 1 },
};

test('converts analytics without dropping daily results or backfill state', () => {
  const result = managed.canonicalFamiliarAnalyticsData({
    ...envelope, operations: ['familiars.analytics.read'], data: { analytics },
  });
  expect(result).toEqual({ ok: true, analytics });
  expect(Object.isFrozen(result.analytics.windows['7d']?.days)).toBe(true);
});

test.each([
  { apiVersion: '2.0' },
  { minimumClientVersion: '999.0.0' },
  { operations: ['familiars.list'] },
  { capabilities: [] },
  { cursor: { hasMore: false } },
  { error: { code: 'forbidden', message: 'Denied', retryable: false } },
  { data: { contract: { ...contract, present: true } } },
])('rejects an incompatible or malformed contract envelope %#', (override) => {
  expect(() => managed.canonicalFamiliarContractData({ ...envelope, ...override })).toThrow();
});

test('rejects native accessors without executing them', () => {
  let accessed = false;
  const input = { ...envelope };
  Object.defineProperty(input, 'data', { get() { accessed = true; return { contract }; } });
  expect(() => managed.canonicalFamiliarContractData(input)).toThrow();
  expect(accessed).toBe(false);
});

test.each(['live', 'backfilled'] as const)('preserves %s attempt provenance', (provenance) => {
  const attempt = {
    id: 'attempt-1', executionKind: 'assistant-response', occurredAt: '2026-09-14T00:00:00.000Z',
    harnessId: 'codex', status: 'completed', toolCalls: 0, toolFailures: 0, provenance,
  };
  const result = managed.canonicalFamiliarAnalyticsData({
    ...envelope, operations: ['familiars.analytics.read'],
    data: { analytics: { ...analytics, recentAttempts: [attempt] } },
  });
  expect(result.analytics.recentAttempts).toEqual([attempt]);
});

test.each([
  { ...analytics, windows: [] },
  { ...analytics, windows: { '7d': { ...analytics.windows['7d'], coverage: undefined } } },
])('rejects malformed canonical analytics %#', (data) => {
  expect(() => managed.canonicalFamiliarAnalyticsData({
    ...envelope, operations: ['familiars.analytics.read'], data: { analytics: data },
  })).toThrow();
});

test('rejects array-shaped identity rather than normalizing it to an empty record', () => {
  expect(() => managed.canonicalFamiliarContractData({
    ...envelope, data: { contract: { ...contract, identity: [] } },
  })).toThrow();
});
