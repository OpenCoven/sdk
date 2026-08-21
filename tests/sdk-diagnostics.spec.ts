import { CAVE_CLIENT_VERSION, CaveClient } from '@opencoven/cave-client';
import { COVEN_CLIENT_VERSION, COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import {
  OPENCOVEN_SDK_VERSION,
  collectOpenCovenDiagnostics,
  createOpenCovenSdk,
  describeSdkCapabilities,
} from '@opencoven/sdk';
import { DIAGNOSTICS_SCHEMA, type OperationEvent } from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

function healthyCave(): CaveClient {
  return new CaveClient({
    transport: {
      health: () => Promise.resolve({ data: { status: 'ok' as const } }),
      familiars: () => Promise.resolve({ ok: true, familiars: [] }),
    },
  });
}

function healthyCoven(): CovenClient {
  return new CovenClient({
    transport: {
      health: () =>
        Promise.resolve({
          ok: true as const,
          apiVersion: COVEN_DAEMON_PROTOCOL,
          covenVersion: '0.1.0',
          capabilities: {
            sessions: true,
            events: true,
            eventCursor: 'sequence',
            structuredErrors: true,
          },
        }),
    },
  });
}

function unauthorizedCave(): CaveClient {
  return new CaveClient({
    transport: {
      health: () =>
        Promise.reject(
          Object.assign(new Error('token rejected: sk-live-not-a-real-key'), {
            code: 'unauthorized',
            requestId: 'req-42',
            statusCode: 401,
          }),
        ),
    },
  });
}

describe('client capabilities', () => {
  test('are read from the transport rather than the network', () => {
    expect(healthyCave().capabilities()).toEqual({
      health: true,
      familiars: true,
      familiarContract: false,
      familiarAnalytics: false,
    });
    expect(healthyCoven().capabilities()).toEqual({ health: true });
  });

  test('distinguish an unconfigured client from a configured one that cannot', () => {
    expect(describeSdkCapabilities(createOpenCovenSdk({}))).toEqual({
      sdk: { health: true, healthReport: true, diagnostics: true },
    });

    expect(describeSdkCapabilities(createOpenCovenSdk({ cave: healthyCave() })).cave).toEqual({
      health: true,
      familiars: true,
      familiarContract: false,
      familiarAnalytics: false,
    });
  });
});

describe('unified diagnostics', () => {
  test('reports package versions, capabilities, and per-operation counts', async () => {
    const sdk = createOpenCovenSdk({ cave: healthyCave(), coven: healthyCoven() });
    const bundle = await sdk.diagnostics({ runtime: { node: 'v24.18.0', platform: 'linux' } });

    expect(bundle.schema).toBe(DIAGNOSTICS_SCHEMA);
    expect(bundle.versions.packages).toEqual({
      '@opencoven/cave-client': CAVE_CLIENT_VERSION,
      '@opencoven/coven-client': COVEN_CLIENT_VERSION,
      '@opencoven/sdk': OPENCOVEN_SDK_VERSION,
    });
    expect(bundle.versions.runtime).toEqual({ node: 'v24.18.0', platform: 'linux' });
    expect(Object.keys(bundle.capabilities).sort()).toEqual(['cave', 'coven', 'sdk']);
    expect(bundle.operations.map((summary) => `${summary.system}.${summary.operation}`)).toEqual([
      'cave.health',
      'coven.health',
    ]);
    expect(bundle.errors).toEqual([]);
  });

  test('carries a failed health check as a code, never as its message', async () => {
    const sdk = createOpenCovenSdk({ cave: unauthorizedCave(), coven: healthyCoven() });
    const bundle = await sdk.diagnostics();

    expect(bundle.errors).toEqual([
      {
        system: 'cave',
        operation: 'health',
        code: 'unauthorized',
        retryable: false,
        requestId: 'req-42',
        statusCode: 401,
      },
    ]);
    expect(JSON.stringify(bundle)).not.toContain('sk-live-not-a-real-key');
    expect(
      bundle.operations.find((summary) => summary.system === 'cave')?.codes,
    ).toEqual(['unauthorized']);
  });

  test('summarizes an endpoint the caller supplies without repeating it', async () => {
    const sdk = createOpenCovenSdk({ cave: healthyCave() });
    const bundle = await sdk.diagnostics({
      discovery: [
        { label: 'cave', url: 'https://operator:hunter2@cave.example.invalid/api?token=abc' },
      ],
    });

    expect(bundle.discovery).toEqual([
      {
        label: 'cave',
        protocol: 'https',
        host: 'redacted',
        port: null,
        loopback: false,
        credentialsInUrl: true,
        query: true,
      },
    ]);
    expect(JSON.stringify(bundle)).not.toContain('hunter2');
  });

  test('merges caller-supplied package versions over the built-in ones', async () => {
    const bundle = await collectOpenCovenDiagnostics(createOpenCovenSdk({}), {
      packages: { '@opencoven/sdk': '9.9.9', 'my-app': '1.2.3' },
    });

    expect(bundle.versions.packages['@opencoven/sdk']).toBe('9.9.9');
    expect(bundle.versions.packages['my-app']).toBe('1.2.3');
  });

  test('leaves the caller observer receiving every event', async () => {
    const seen: OperationEvent[] = [];
    const sdk = createOpenCovenSdk({ cave: healthyCave() });
    const bundle = await sdk.diagnostics({
      observer: {
        onEvent(event) {
          seen.push(event);
        },
        onObserverError(error) {
          throw error;
        },
      },
    });

    expect(seen.map((event) => event.phase)).toEqual(['start', 'success']);
    expect(bundle.operations[0]?.started).toBe(1);
  });

  test('records the event even when the caller observer throws on it', async () => {
    const reported: unknown[] = [];
    const sdk = createOpenCovenSdk({ cave: healthyCave() });
    const bundle = await sdk.diagnostics({
      observer: {
        onEvent() {
          throw new Error('observer failed');
        },
        onObserverError(error) {
          reported.push(error);
        },
      },
    });

    expect(reported).toHaveLength(2);
    expect(bundle.operations[0]).toMatchObject({
      system: 'cave',
      operation: 'health',
      started: 1,
      succeeded: 1,
    });
  });

  test('collects operations when the caller supplies no observer at all', async () => {
    const sdk = createOpenCovenSdk({ cave: healthyCave() });
    const bundle = await sdk.diagnostics();

    expect(bundle.operations[0]?.succeeded).toBe(1);
  });

  test('forwards the caller cancellation and per-client budgets', async () => {
    const controller = new AbortController();
    const sdk = createOpenCovenSdk({ cave: healthyCave(), coven: healthyCoven() });
    const bundle = await sdk.diagnostics({
      signal: controller.signal,
      timeoutMs: 1_000,
      cave: { timeoutMs: 500 },
      coven: { timeoutMs: 500 },
    });

    expect(bundle.errors).toEqual([]);
    expect(bundle.operations).toHaveLength(2);
  });
});
