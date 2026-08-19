import { CaveClient, isCaveClientError } from '@opencoven/cave-client';
import { describe, expect, test } from 'vitest';

/**
 * The familiar operations mirror routes Cave already serves. What these hold
 * is the boundary: that a refusal is raised rather than read as emptiness,
 * that a malformed roster fails loudly rather than quietly losing a familiar,
 * and that the wire's snake_case does not escape the client.
 */

const ROSTER_WIRE = {
  id: 'cody',
  display_name: 'Cody',
  role: 'Implementation',
  pronouns: 'he/him',
  status: 'working',
  last_seen: '2026-08-19T07:00:00Z',
  active_sessions: 2,
  memory_freshness: 'fresh',
} as const;

const CONTRACT_REPORT = {
  specVersion: '0.1.0',
  pass: true,
  properties: [
    { property: 'Named Identity', pass: true },
    { property: 'Persistent Memory', pass: false },
  ],
  violations: [],
  warnings: [{ file: 'MEMORY.md', field: 'memory', message: 'No MEMORY.md' }],
} as const;

const ANALYTICS = {
  generatedAt: '2026-08-19T07:00:00Z',
  windows: {
    '7d': {
      attempts: 4,
      completed: 3,
      failed: 1,
      cancelled: 0,
      successRate: 0.75,
      toolCalls: 9,
      toolFailures: 1,
      models: [],
      harnesses: [],
      coverage: {},
    },
  },
  recentAttempts: [
    {
      id: 'a1',
      executionKind: 'assistant-response',
      occurredAt: '2026-08-19T06:00:00Z',
      harnessId: 'claude-code',
      status: 'completed',
      toolCalls: 3,
      toolFailures: 0,
    },
  ],
  backfill: { state: 'partial', imported: 12, remaining: 4 },
} as const;

function clientWith(overrides: Record<string, unknown>): CaveClient {
  return new CaveClient({
    transport: {
      health: () => Promise.resolve({ data: { status: 'ok' } }),
      ...overrides,
    } as never,
  });
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (isCaveClientError(error)) {
      return error.normalized.code;
    }

    throw error;
  }

  throw new Error('Expected the call to reject.');
}

describe('cave familiars', () => {
  test('maps the roster out of the wire spelling', async () => {
    const client = clientWith({
      familiars: () => Promise.resolve({ ok: true, familiars: [ROSTER_WIRE] }),
    });

    const [familiar] = await client.familiars();

    expect(familiar).toEqual({
      id: 'cody',
      displayName: 'Cody',
      role: 'Implementation',
      pronouns: 'he/him',
      status: 'working',
      lastSeen: '2026-08-19T07:00:00Z',
      activeSessions: 2,
      memoryFreshness: 'fresh',
    });
    // The wire spelling must not survive the client.
    expect(Object.keys(familiar ?? {})).not.toContain('display_name');
  });

  test('omits absent optional fields rather than defining them as undefined', async () => {
    const client = clientWith({
      familiars: () =>
        Promise.resolve({
          ok: true,
          familiars: [{ id: 'echo', display_name: 'Echo', role: 'Correspondence' }],
        }),
    });

    const [familiar] = await client.familiars();

    expect(Object.keys(familiar ?? {})).toEqual(['id', 'displayName', 'role']);
  });

  test('raises a refusal instead of reading it as an empty roster', async () => {
    // `{ ok: false }` carries no familiars. Read leniently it looks like "none",
    // which is the wrong answer to "the hub rejected this Cave's token".
    const client = clientWith({
      familiars: () =>
        Promise.resolve({ ok: false, error: 'Not authorized', reason: 'unauthorized' }),
    });

    expect(await codeOf(() => client.familiars())).toBe('unauthorized');
  });

  test('fails the whole roster when one entry is malformed', async () => {
    const client = clientWith({
      familiars: () =>
        Promise.resolve({ ok: true, familiars: [ROSTER_WIRE, { id: 'x', role: 'y' }] }),
    });

    expect(await codeOf(() => client.familiars())).toBe('invalid_response');
  });

  test('reports an operation the transport does not implement', async () => {
    // An older transport still satisfies the interface; calling through it
    // should say so rather than throw on undefined.
    expect(await codeOf(() => clientWith({}).familiars())).toBe('unsupported_operation');
  });

  test('returns the contract report, warnings and all', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({ ok: true, id: 'cody', present: true, report: CONTRACT_REPORT }),
    });

    const contract = await client.familiarContract('cody');

    expect(contract.present).toBe(true);
    expect(contract.report.pass).toBe(true);
    // A warning does not fail a contract, and must survive to the caller.
    expect(contract.report.warnings).toHaveLength(1);
    expect(contract.report.properties).toHaveLength(2);
  });

  test('rejects a contract report missing its spec version', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          present: true,
          report: { pass: true, properties: [], violations: [] },
        }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('invalid_response');
  });

  test('keeps a null success rate distinct from zero', async () => {
    const empty = {
      ...ANALYTICS,
      windows: { '7d': { ...ANALYTICS.windows['7d'], attempts: 0, successRate: null } },
    };
    const client = clientWith({
      familiarAnalytics: () => Promise.resolve({ ok: true, analytics: empty }),
    });

    const analytics = await client.familiarAnalytics('cody');

    // A rate over no attempts is unknown, not nought per cent.
    expect(analytics.windows['7d']?.successRate).toBeNull();
  });

  test('carries the backfill state through untouched', async () => {
    const client = clientWith({
      familiarAnalytics: () => Promise.resolve({ ok: true, analytics: ANALYTICS }),
    });

    const analytics = await client.familiarAnalytics('cody');

    // Numbers drawn from a partial import are a different claim from numbers
    // drawn from all of it. The caller cannot say so if this is dropped.
    expect(analytics.backfill).toEqual({ state: 'partial', imported: 12, remaining: 4 });
    expect(analytics.recentAttempts[0]?.harnessId).toBe('claude-code');
  });

  test('rejects analytics whose attempts are malformed', async () => {
    const client = clientWith({
      familiarAnalytics: () =>
        Promise.resolve({
          ok: true,
          analytics: { ...ANALYTICS, recentAttempts: [{ id: 'a1', status: 'exploded' }] },
        }),
    });

    expect(await codeOf(() => client.familiarAnalytics('cody'))).toBe('invalid_response');
  });
});
