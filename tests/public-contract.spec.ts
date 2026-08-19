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
    expect(hasFunction(core, 'normalizeError')).toBe(true);
    expect(hasFunction(core, 'assessCompatibility')).toBe(true);
    expect(hasFunction(cave, 'CaveClient')).toBe(true);
    expect(hasFunction(cave, 'parseCaveContractFixture')).toBe(true);
    expect(hasFunction(cave, 'parseVerifiedCaveContractFixture')).toBe(true);
    expect(hasFunction(cave, 'verifyCaveContractFixtureDigest')).toBe(true);
    expect(hasFunction(cave, 'normalizeCaveError')).toBe(true);
    expect(hasFunction(coven, 'CovenClient')).toBe(true);
    expect(hasFunction(coven, 'normalizeCovenError')).toBe(true);
    expect(hasFunction(sdk, 'OpenCovenSdk')).toBe(true);
    expect(hasFunction(sdk, 'createOpenCovenSdk')).toBe(true);
    expect(hasFunction(cli, 'formatCliOutput')).toBe(true);
    expect(hasFunction(cli, 'runCli')).toBe(true);
  });

  test('exposes additive unified health reporting', () => {
    const instance = sdk.createOpenCovenSdk({});

    expect(instance.healthReport).toBeTypeOf('function');
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
