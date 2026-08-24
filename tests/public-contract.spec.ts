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

function exportedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe('public package entry points', () => {
  test('exports the exact supported public SDK surfaces', () => {
    expect(exportedKeys(core)).toEqual([
      'DISCOVERY_PROFILES',
      'DISCOVERY_PROTOCOL',
      'DISCOVERY_RECORD_VERSION',
      'DiscoveryContractError',
      'InvalidSecretKeyError',
      'OperationAbortedError',
      'OperationConfigurationError',
      'OperationTimeoutError',
      'SecretStoreDisposedError',
      'assessCompatibility',
      'createManagedMemorySecretStore',
      'createMemorySecretStore',
      'createOperationScope',
      'createSecretStoreReference',
      'isOperationAbortedError',
      'isOperationTimeoutError',
      'normalizeError',
      'parseDiscoveryEndpoint',
      'parseDiscoveryRecord',
      'runOperation',
    ]);
    expect(exportedKeys(cave)).toEqual([
      'CAVE_ANALYTICS_WINDOWS',
      'CAVE_CLIENT_VERSION',
      'CAVE_FAMILIAR_PROPERTIES',
      'CAVE_PAIRING_SCOPES',
      'CAVE_PAIRING_STATUSES',
      'CaveClient',
      'CaveClientError',
      'CaveDiscoveryError',
      'CavePairingSession',
      'createCaveClient',
      'createDiscoveredCaveClient',
      'digestCaveContractFixture',
      'discoverCaveEndpoint',
      'isCaveClientError',
      'isCaveDiscoveryError',
      'normalizeCaveError',
      'parseCaveContractFixture',
      'parseVerifiedCaveContractFixture',
      'verifyCaveContractFixtureDigest',
    ]);
    expect(exportedKeys(coven)).toEqual([
      'COVEN_DAEMON_PROTOCOL',
      'CovenClient',
      'CovenClientError',
      'CovenDaemonResponseError',
      'CovenIpcError',
      'createCovenClient',
      'createCovenUnixTransport',
      'createCovenWindowsTransport',
      'createDiscoveredCovenClient',
      'discoverCovenEndpoint',
      'isCovenClientError',
      'isCovenDaemonResponseError',
      'isCovenIpcError',
      'normalizeCovenError',
    ]);
    expect(exportedKeys(sdk)).toEqual([
      'OpenCovenSdk',
      'OpenCovenSdkError',
      'createOpenCovenSdk',
    ]);
    expect(exportedKeys(cli)).toEqual([
      'CLI_USAGE',
      'DEV_CLI_VERSION',
      'SecureStoreUnavailableError',
      'createNativeSecretStore',
      'formatCliOutput',
      'main',
      'runCli',
    ]);

    expect(hasFunction(core, 'createMemorySecretStore')).toBe(true);
    expect(hasFunction(cave, 'CaveClient')).toBe(true);
    expect(hasFunction(coven, 'createCovenUnixTransport')).toBe(true);
    expect(hasFunction(sdk, 'createOpenCovenSdk')).toBe(true);
    expect(hasFunction(cli, 'runCli')).toBe(true);
  });

  test('exposes additive unified health reporting', () => {
    const instance = sdk.createOpenCovenSdk({});

    expect(instance.healthReport.bind(instance)).toBeTypeOf('function');
  });

  test('adds pairing and credential helpers without removing existing Cave APIs', () => {
    const client = new cave.CaveClient({
      transport: {
        health: () => Promise.resolve({ data: { status: 'ok' as const } }),
      },
      credentials: {
        store: core.createMemorySecretStore(),
        reference: core.createSecretStoreReference('cave-credential'),
      },
    });

    expect(client.createPairing.bind(client)).toBeTypeOf('function');
    expect(client.credentialStatus.bind(client)).toBeTypeOf('function');
    expect(client.forgetCredential.bind(client)).toBeTypeOf('function');
    expect((cave as { CAVE_PAIRING_SCOPES?: unknown }).CAVE_PAIRING_SCOPES).toEqual(
      expect.any(Array),
    );
    expect(client.familiars.bind(client)).toBeTypeOf('function');
    expect(client.familiarAnalytics.bind(client)).toBeTypeOf('function');
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
