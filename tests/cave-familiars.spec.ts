import {
  CaveClient,
  canonicalFamiliarAnalyticsData,
  canonicalFamiliarContractData,
  isCaveClientError,
} from '@opencoven/cave-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

type CaveTransportOverrides = Record<string, unknown> & {
  health?: never;
};

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

const PRESENT = { soul: true, identity: true, ward: true, memory: false } as const;

const WARD = {
  version: '0.1.0',
  familiar: 'cody',
  person: 'val',
  protectedFiles: ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'ward.toml'],
  invariants: ["familiar.name == 'Cody'"],
  editablePaths: ['TOOLS.md', 'scratch/'],
  approvalTiers: {
    auto: ['run tests', 'read files'],
    humanReview: ['push a branch', 'merge a pull request'],
  },
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

function clientWith(overrides: CaveTransportOverrides): CaveClient {
  return new CaveClient({
    transport: {
      health: () => Promise.resolve({
        apiVersion: '1.0',
        capabilities: ['health'],
        minimumClientVersion: '0.1.0',
        operations: ['health.read'],
        data: {
          instanceId: 'test-cave',
          pairingRequired: true,
          releaseVersion: '0.3.9',
        },
      }),
      ...overrides,
    },
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

afterEach(() => {
  vi.useRealTimers();
});

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

  test('enforces operation controls for a never-settling roster transport', async () => {
    vi.useFakeTimers();
    let context: OperationContext | undefined;
    const client = clientWith({
      familiars: (receivedContext?: OperationContext) => {
        context = receivedContext;
        return new Promise<never>(() => undefined);
      },
    });
    const result = client.familiars({ timeoutMs: 10 });
    const caught = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(context?.signal.aborted).toBe(true);
    expect(await caught).toMatchObject({
      normalized: {
        operation: 'familiars',
        code: 'timeout',
      },
    });
  });

  test('separates analytics transport options from operation controls', async () => {
    vi.useFakeTimers();
    let receivedOptions: { recentLimit?: number } | undefined;
    let context: OperationContext | undefined;
    const client = clientWith({
      familiarAnalytics: (
        _familiarId: string,
        options?: { recentLimit?: number },
        receivedContext?: OperationContext,
      ) => {
        receivedOptions = options;
        context = receivedContext;
        return Promise.resolve({ ok: true, analytics: ANALYTICS });
      },
    });

    await client.familiarAnalytics('cody', {
      recentLimit: 5,
      timeoutMs: 100,
    });

    expect(receivedOptions).toEqual({ recentLimit: 5 });
    expect(context?.deadline).toBe(performance.now() + 100);
    expect(vi.getTimerCount()).toBe(0);
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
        Promise.resolve({ ok: true, id: 'cody', present: PRESENT, report: CONTRACT_REPORT }),
    });

    const contract = await client.familiarContract('cody');

    expect(contract.present).toEqual(PRESENT);
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
          present: PRESENT,
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

  test('rejects an envelope that never says it succeeded', async () => {
    // `ok` absent is not `ok: false`, but it is not success either. Treating
    // "not a refusal" as "a success" lets a malformed envelope through as an
    // empty roster.
    const client = clientWith({ familiars: () => Promise.resolve({ familiars: [] }) });

    expect(await codeOf(() => client.familiars())).toBe('invalid_response');
  });

  test('rejects a contract report with no warnings list', async () => {
    // Omitting `warnings` is not the same as having none, and reading it as
    // none would hide the difference behind a shape this client cannot vouch
    // for.
    const withoutWarnings: Record<string, unknown> = { ...CONTRACT_REPORT };

    delete withoutWarnings.warnings;

    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({ ok: true, present: PRESENT, report: withoutWarnings }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('invalid_response');
  });

  test('rejects a violation entry that is not one', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          present: PRESENT,
          report: { ...CONTRACT_REPORT, violations: [{ file: 'SOUL.md' }] },
        }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('invalid_response');
  });

  test('rejects a window whose model slices are malformed', async () => {
    const client = clientWith({
      familiarAnalytics: () =>
        Promise.resolve({
          ok: true,
          analytics: {
            ...ANALYTICS,
            windows: { '7d': { ...ANALYTICS.windows['7d'], models: [{ key: 'x' }] } },
          },
        }),
    });

    expect(await codeOf(() => client.familiarAnalytics('cody'))).toBe('invalid_response');
  });

  test('rejects a backfill missing its imported count', async () => {
    const client = clientWith({
      familiarAnalytics: () =>
        Promise.resolve({
          ok: true,
          analytics: { ...ANALYTICS, backfill: { state: 'partial' } },
        }),
    });

    expect(await codeOf(() => client.familiarAnalytics('cody'))).toBe('invalid_response');
  });

  test('rejects a backfill state it does not recognise', async () => {
    const client = clientWith({
      familiarAnalytics: () =>
        Promise.resolve({
          ok: true,
          analytics: { ...ANALYTICS, backfill: { state: 'mostly', imported: 3 } },
        }),
    });

    expect(await codeOf(() => client.familiarAnalytics('cody'))).toBe('invalid_response');
  });

  test('carries the ward and identity through when the files exist', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          id: 'cody',
          present: PRESENT,
          identity: { name: 'Cody', creature: 'Implementation familiar', person: 'Val' },
          ward: WARD,
          report: CONTRACT_REPORT,
        }),
    });

    const contract = await client.familiarContract('cody');

    expect(contract.identity).toEqual({ name: 'Cody', creature: 'Implementation familiar', person: 'Val' });
    // The must-ask list is what a composer matches a draft against.
    expect(contract.ward?.approvalTiers.humanReview).toEqual(['push a branch', 'merge a pull request']);
    expect(contract.ward?.editablePaths).toEqual(['TOOLS.md', 'scratch/']);
  });

  test('leaves identity and ward absent when their files are', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          id: 'cody',
          present: { soul: true, identity: false, ward: false, memory: false },
          report: CONTRACT_REPORT,
        }),
    });

    const contract = await client.familiarContract('cody');

    expect('identity' in contract).toBe(false);
    expect('ward' in contract).toBe(false);
    expect(contract.present.ward).toBe(false);
  });

  test('refuses the retired boolean presence rather than reading it as complete', async () => {
    // A transport still answering the private route's old shape. Reading
    // `true` as "every file exists" would hide exactly what the field is for.
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({ ok: true, id: 'cody', present: true, report: CONTRACT_REPORT }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('invalid_response');
  });

  test('rejects a ward whose tiers are not string lists', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          id: 'cody',
          present: PRESENT,
          ward: { ...WARD, approvalTiers: { auto: 'read files', humanReview: [] } },
          report: CONTRACT_REPORT,
        }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('invalid_response');
  });

  test('keeps the day series on a window and forwards the window narrowing', async () => {
    const seen: unknown[] = [];
    const days = [
      { date: '2026-08-17', completed: 1, failed: 0, cancelled: 0 },
      { date: '2026-08-18', completed: 2, failed: 1, cancelled: 0 },
    ];
    const client = clientWith({
      familiarAnalytics: (_familiarId: string, options: unknown) => {
        seen.push(options);
        return Promise.resolve({
          ok: true,
          analytics: {
            ...ANALYTICS,
            windows: { '7d': { ...ANALYTICS.windows['7d'], days } },
          },
        });
      },
    });

    const analytics = await client.familiarAnalytics('cody', { window: '7d', recentLimit: 5 });

    expect(analytics.windows['7d']?.days).toEqual(days);
    expect(seen).toEqual([{ recentLimit: 5, window: '7d' }]);
  });

  test('rejects a day series entry that is not one', async () => {
    const client = clientWith({
      familiarAnalytics: () =>
        Promise.resolve({
          ok: true,
          analytics: {
            ...ANALYTICS,
            windows: { '7d': { ...ANALYTICS.windows['7d'], days: [{ date: '2026-08-18' }] } },
          },
        }),
    });

    expect(await codeOf(() => client.familiarAnalytics('cody'))).toBe('invalid_response');
  });

  test('rejects an identity field that is not a string', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          id: 'cody',
          present: PRESENT,
          identity: { name: 'Cody', creature: 42 },
          report: CONTRACT_REPORT,
        }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('invalid_response');
  });

  test('rejects a ward whose invariants are not a string list', async () => {
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          id: 'cody',
          present: PRESENT,
          ward: { ...WARD, invariants: [{ rule: 'familiar.name' }] },
          report: CONTRACT_REPORT,
        }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('invalid_response');
  });

  test('accepts a ward and identity that state only what the files carry', async () => {
    // Every optional field absent: the ward names no [meta], the identity no
    // fields. Absence is a real answer, not a malformed one.
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          id: 'cody',
          present: PRESENT,
          identity: {},
          ward: {
            protectedFiles: [],
            invariants: [],
            editablePaths: [],
            approvalTiers: { auto: [], humanReview: [] },
          },
          report: CONTRACT_REPORT,
        }),
    });

    const contract = await client.familiarContract('cody');

    expect(contract.identity).toEqual({});
    expect(contract.ward?.version).toBeUndefined();
    expect(contract.ward?.approvalTiers).toEqual({ auto: [], humanReview: [] });
  });

  test('lets a host-owned transport hand over the canonical envelope it received', async () => {
    // A native bridge returns what Cave sent. The exported envelope readers
    // are how it becomes the response these operations consume, so the
    // declaration check happens once in the SDK rather than being
    // reimplemented against the same wire by every host.
    const envelope = (data: Record<string, unknown>, declarations: {
      capabilities: string[];
      operations: string[];
    }) => ({
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: declarations.capabilities,
      operations: declarations.operations,
      data,
    });
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({
          ok: true,
          ...canonicalFamiliarContractData(
            envelope(
              { contract: { id: 'cody', present: PRESENT, ward: WARD, report: CONTRACT_REPORT } },
              { capabilities: ['familiar-contract'], operations: ['familiars.contract.read'] },
            ),
          ),
        }),
      familiarAnalytics: () =>
        Promise.resolve({
          ok: true,
          analytics: canonicalFamiliarAnalyticsData(
            envelope(
              { analytics: ANALYTICS },
              { capabilities: ['familiar-analytics'], operations: ['familiars.analytics.read'] },
            ),
          ),
        }),
    });

    const contract = await client.familiarContract('cody');
    expect(contract.ward?.approvalTiers.humanReview).toEqual([
      'push a branch',
      'merge a pull request',
    ]);
    await expect(client.familiarAnalytics('cody')).resolves.toMatchObject({
      backfill: { state: 'partial' },
    });

    // An instance that does not advertise the family is refused here, before
    // the client ever sees a contract-shaped object.
    expect(() =>
      canonicalFamiliarContractData(
        envelope(
          { contract: { id: 'cody', present: PRESENT, report: CONTRACT_REPORT } },
          { capabilities: ['familiars'], operations: ['familiars.list'] },
        ),
      ),
    ).toThrow();
  });

  test('surfaces the reason code on a contract refusal', async () => {
    // Every refusal envelope carries `reason`, and every response type now
    // declares it, so this is a documented field rather than one the client
    // reads speculatively.
    const client = clientWith({
      familiarContract: () =>
        Promise.resolve({ ok: false, error: 'path not allowed', reason: 'forbidden' }),
    });

    expect(await codeOf(() => client.familiarContract('cody'))).toBe('forbidden');
  });
});
