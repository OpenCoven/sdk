import * as cave from '@opencoven/cave-client';
import * as coven from '@opencoven/coven-client';
import * as cli from '@opencoven/dev-cli';
import * as sdk from '@opencoven/sdk';
import * as core from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

interface NormalizedError {
  system: 'cave' | 'coven';
  code: string;
  retryable: boolean;
  operation: string;
}

type ErrorNormalizer = (error: unknown, operation: string) => NormalizedError;

function hasFunction(value: object, key: string): boolean {
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'function';
}

describe('public package entry points', () => {
  test('exports the supported public SDK surfaces', () => {
    expect(hasFunction(core, 'createMemorySecretStore')).toBe(true);
    expect(hasFunction(core, 'createManagedMemorySecretStore')).toBe(true);
    expect(hasFunction(core, 'InvalidSecretKeyError')).toBe(true);
    expect(hasFunction(core, 'SecretStoreDisposedError')).toBe(true);
    expect(hasFunction(core, 'normalizeError')).toBe(true);
    expect(hasFunction(core, 'assessCompatibility')).toBe(true);
    expect(hasFunction(core, 'createOperationScope')).toBe(true);
    expect(hasFunction(core, 'runOperation')).toBe(true);
    expect(hasFunction(core, 'isOperationTimeoutError')).toBe(true);
    expect(hasFunction(core, 'isOperationAbortedError')).toBe(true);
    expect(hasFunction(core, 'OperationTimeoutError')).toBe(true);
    expect(hasFunction(core, 'OperationAbortedError')).toBe(true);
    expect(hasFunction(core, 'OperationConfigurationError')).toBe(true);
    expect(hasFunction(cave, 'CaveClient')).toBe(true);
    expect(hasFunction(cave, 'parseCaveContractFixture')).toBe(true);
    expect(hasFunction(cave, 'parseVerifiedCaveContractFixture')).toBe(true);
    expect(hasFunction(cave, 'verifyCaveContractFixtureDigest')).toBe(true);
    expect(hasFunction(cave, 'normalizeCaveError')).toBe(true);
    expect(hasFunction(cave, 'isCaveClientError')).toBe(true);
    expect(hasFunction(coven, 'CovenClient')).toBe(true);
    expect(hasFunction(coven, 'normalizeCovenError')).toBe(true);
    expect(hasFunction(coven, 'isCovenClientError')).toBe(true);
    expect(hasFunction(sdk, 'OpenCovenSdk')).toBe(true);
    expect(hasFunction(sdk, 'createOpenCovenSdk')).toBe(true);
    expect(hasFunction(cli, 'formatCliOutput')).toBe(true);
    expect(hasFunction(cli, 'runCli')).toBe(true);
  });

  test('exports the diagnostics, completion, and scaffold surfaces', () => {
    expect(hasFunction(core, 'createDiagnosticsBundle')).toBe(true);
    expect(hasFunction(core, 'summarizeDiagnosticsEndpoint')).toBe(true);
    expect(hasFunction(core, 'summarizeOperationEvents')).toBe(true);
    expect(hasFunction(core, 'sanitizeDiagnosticsError')).toBe(true);
    expect(core.DIAGNOSTICS_SCHEMA).toBe('opencoven.diagnostics.v1');
    expect(hasFunction(sdk, 'collectOpenCovenDiagnostics')).toBe(true);
    expect(hasFunction(sdk, 'describeSdkCapabilities')).toBe(true);
    expect(hasFunction(cli, 'createCliDiagnostics')).toBe(true);
    expect(hasFunction(cli, 'renderCliDiagnostics')).toBe(true);
    expect(hasFunction(cli, 'renderCompletionScript')).toBe(true);
    expect(hasFunction(cli, 'createScaffoldFiles')).toBe(true);
    expect(hasFunction(cli, 'writeScaffoldFiles')).toBe(true);
    expect([...cli.COMPLETION_SHELLS]).toEqual(['bash', 'zsh', 'fish', 'powershell']);
    expect([...cli.SCAFFOLD_TEMPLATES]).toEqual([
      'cave-chat',
      'coven-observer',
      'unified-status',
    ]);
  });

  test('reports transport-derived capabilities from both clients', () => {
    const caveClient = new cave.CaveClient({
      transport: { health: () => Promise.resolve({ data: { status: 'ok' as const } }) },
    });
    const covenClient = new coven.CovenClient({
      transport: {
        health: () =>
          Promise.resolve({
            ok: true as const,
            apiVersion: coven.COVEN_DAEMON_PROTOCOL,
            covenVersion: '0.1.0',
            capabilities: { sessions: true, events: true, structuredErrors: true },
          }),
      },
    });

    expect(caveClient.capabilities()).toEqual({
      health: true,
      familiars: false,
      familiarContract: false,
      familiarAnalytics: false,
    });
    expect(covenClient.capabilities()).toEqual({ health: true });
  });

  test('exposes additive unified health reporting', () => {
    const instance = sdk.createOpenCovenSdk({});

    expect(instance.healthReport.bind(instance)).toBeTypeOf('function');
  });

  test('normalizes Cave unauthorized errors with an explicit operation', () => {
    const normalizeCaveError = (cave as { normalizeCaveError?: ErrorNormalizer }).normalizeCaveError;
    const normalized = normalizeCaveError?.({ code: 'unauthorized' }, 'health');

    expect(normalized).toEqual({
      system: 'cave',
      code: 'unauthorized',
      retryable: false,
      operation: 'health',
      message: 'Cave health request failed',
    });
  });

  test('normalizes Coven errors without inferring discovery or credentials', () => {
    const normalizeCovenError = (coven as { normalizeCovenError?: ErrorNormalizer }).normalizeCovenError;
    const normalized = normalizeCovenError?.({ code: 'session_not_live' }, 'health');

    expect(normalized).toEqual({
      system: 'coven',
      code: 'session_not_live',
      retryable: false,
      operation: 'health',
      message: 'Coven health request failed',
    });
  });
});
