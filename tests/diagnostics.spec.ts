import {
  createOpenCovenDiagnosticReport,
  OPENCOVEN_DIAGNOSTIC_VERSION,
  OpenCovenDiagnosticError,
  type OpenCovenDiagnosticCheckInput,
} from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

const generatedAt = '2026-08-25T06:50:00.000Z';
const runtime = {
  name: 'node',
  version: 'v24.18.1',
  platform: 'darwin',
  architecture: 'arm64',
} as const;

describe('redacted diagnostics', () => {
  test('builds a bounded allowlisted report from raw observations', () => {
    const report = createOpenCovenDiagnosticReport({
      generatedAt,
      packageVersion: '0.1.0',
      runtime,
      checks: [
        {
          id: 'cave.discovery',
          status: 'ok',
          discovery: {
            endpoint: {
              kind: 'http',
              url: 'http://127.0.0.1:3020/private',
            },
            freshness: {
              pid: 42,
              nonce: 'secret-nonce',
            },
            record: {
              path: '/Users/example/private/discovery.json',
            },
          },
        },
        {
          id: 'cave.health',
          status: 'ok',
          observedAt: generatedAt,
          health: {
            apiVersion: '1.0',
            releaseVersion: '0.1.0',
            instanceId: '018f4f1a-77c2-7a31-8a15-55a25aaba099',
            pairingRequired: true,
            capabilities: [
              'health',
              'pairing',
              'prompt-private-content',
            ],
            operations: [
              'health.read',
              'pairing.create',
              'private.operation',
            ],
          },
        },
        {
          id: 'secure-store',
          status: 'ok',
          observedAt: generatedAt,
        },
        {
          id: 'coven.discovery',
          status: 'ok',
          discovery: {
            protocol: 'coven.daemon.v1',
            endpoint: {
              kind: 'unix',
              path: '/private/coven.sock',
            },
            owner: {
              uid: 501,
            },
          },
        },
        {
          id: 'coven.health',
          status: 'error',
          error: {
            code: 'connect_failure',
            retryable: true,
            diagnosticId: '018f4f1a-77c2-7a31-8a15-55a25aaba098',
            message: 'private daemon output',
            cause: new Error('private cause'),
            details: {
              prompt: 'private prompt',
            },
          },
        },
      ],
    });

    expect(report).toEqual({
      version: OPENCOVEN_DIAGNOSTIC_VERSION,
      generatedAt,
      environment: {
        packageVersion: '0.1.0',
        runtime: 'node',
        runtimeVersion: 'v24.18.1',
        platform: 'darwin',
        architecture: 'arm64',
      },
      checks: [
        {
          id: 'cave.discovery',
          system: 'cave',
          phase: 'discovery',
          status: 'ok',
          outcome: 'discovered',
        },
        {
          id: 'cave.health',
          system: 'cave',
          phase: 'health',
          status: 'ok',
          facts: {
            apiVersion: '1.0',
            releaseVersion: '0.1.0',
            instanceSuffix: '5aaba099',
            pairingRequired: true,
            capabilities: ['health', 'pairing'],
            operations: ['health.read', 'pairing.create'],
            lastHealthyAt: generatedAt,
          },
        },
        {
          id: 'secure-store',
          system: 'secure-store',
          phase: 'credential-store',
          status: 'ok',
          facts: {
            backend: 'native',
            lastHealthyAt: generatedAt,
          },
        },
        {
          id: 'coven.discovery',
          system: 'coven',
          phase: 'discovery',
          status: 'ok',
          outcome: 'discovered',
          facts: {
            protocol: 'coven.daemon.v1',
            transport: 'unix',
          },
        },
        {
          id: 'coven.health',
          system: 'coven',
          phase: 'health',
          status: 'error',
          error: {
            code: 'connect_failure',
            retryable: true,
            diagnosticId: '018f4f1a-77c2-7a31-8a15-55a25aaba098',
          },
        },
      ],
      summary: {
        healthy: false,
        ok: 4,
        error: 1,
        skipped: 0,
      },
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(
      /private|endpoint|path|record|pid|nonce|prompt|message|cause|details/iu,
    );
  });

  test('does not invoke accessors or retain unknown error and capability data', () => {
    let invoked = false;
    const hostile = {};
    for (const key of [
      'code',
      'retryable',
      'requestId',
      'message',
      'cause',
      'details',
    ]) {
      Object.defineProperty(hostile, key, {
        enumerable: true,
        get() {
          invoked = true;
          return 'private';
        },
      });
    }

    const report = createOpenCovenDiagnosticReport({
      generatedAt,
      packageVersion: '0.1.0',
      runtime,
      checks: [
        {
          id: 'cave.health',
          status: 'error',
          error: hostile,
        },
      ],
    });

    expect(report.checks).toEqual([
      {
        id: 'cave.health',
        system: 'cave',
        phase: 'health',
        status: 'error',
        error: {
          code: 'unknown',
          retryable: false,
        },
      },
    ]);
    expect(invoked).toBe(false);
  });

  test('bounds checks and requires unique supported check identifiers', () => {
    expect(() =>
      createOpenCovenDiagnosticReport({
        generatedAt,
        packageVersion: '0.1.0',
        runtime,
        checks: [
          { id: 'cave.discovery', status: 'ok' },
          { id: 'cave.discovery', status: 'ok' },
        ],
      }),
    ).toThrow(/duplicate/iu);
    expect(() =>
      createOpenCovenDiagnosticReport({
        generatedAt,
        packageVersion: '0.1.0',
        runtime,
        checks: Array.from({ length: 17 }, () => ({
          id: 'unknown',
          status: 'ok',
        })) as unknown as OpenCovenDiagnosticCheckInput[],
      }),
    ).toThrow(/bounded/iu);
  });

  test('omits untrusted versions and identifiers instead of leaking them', () => {
    const report = createOpenCovenDiagnosticReport({
      generatedAt,
      packageVersion: '0.1.0',
      runtime,
      checks: [
        {
          id: 'cave.health',
          status: 'ok',
          observedAt: generatedAt,
          health: {
            apiVersion: `1.${'9'.repeat(100)}`,
            releaseVersion: '1.0.0-sk-live-SUPERSECRET',
            instanceId: 'account-password',
            capabilities: [],
            operations: [],
          },
        },
        {
          id: 'coven.health',
          status: 'error',
          error: {
            code: 'timeout',
            retryable: true,
            requestId: 'token:sk-live-secret',
            diagnosticId: 'not-a-uuid',
          },
        },
      ],
    });

    expect(report.checks).toEqual([
      {
        id: 'cave.health',
        system: 'cave',
        phase: 'health',
        status: 'ok',
        facts: {
          capabilities: [],
          operations: [],
          lastHealthyAt: generatedAt,
        },
      },
      {
        id: 'coven.health',
        system: 'coven',
        phase: 'health',
        status: 'error',
        error: {
          code: 'timeout',
          retryable: true,
        },
      },
    ]);
    expect(JSON.stringify(report)).not.toMatch(
      /SUPERSECRET|password|sk-live/iu,
    );
  });

  test('maps hostile check arrays to the typed diagnostic error', () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();

    expect(() =>
      createOpenCovenDiagnosticReport({
        generatedAt,
        packageVersion: '0.1.0',
        runtime,
        checks: proxy,
      }),
    ).toThrowError(OpenCovenDiagnosticError);
  });
});
