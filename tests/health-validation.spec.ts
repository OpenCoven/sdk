import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CaveClient, CaveClientError } from '@opencoven/cave-client';
import { COVEN_DAEMON_PROTOCOL, CovenClient, CovenClientError } from '@opencoven/coven-client';
import * as core from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

interface CompatibilityAssessment {
  compatible: boolean;
  minimumClientVersion: string;
  clientVersion: string;
}

type CompatibilityAssessor = (
  minimumClientVersion: string,
  clientVersion: string,
) => CompatibilityAssessment;

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cavePackageVersion = (
  JSON.parse(readFileSync(resolve(workspaceRoot, 'packages/cave/package.json'), 'utf8')) as {
    version: string;
  }
).version;

const SEMVER_PRECEDENCE_EXAMPLES = [
  '1.0.0-alpha',
  '1.0.0-alpha.1',
  '1.0.0-alpha.beta',
  '1.0.0-beta',
  '1.0.0-beta.2',
  '1.0.0-beta.11',
  '1.0.0-rc.1',
  '1.0.0',
] as const;

const VALID_COVEN_HEALTH_RESPONSE = {
  ok: true,
  apiVersion: COVEN_DAEMON_PROTOCOL,
  covenVersion: '0.1.0',
  capabilities: {
    sessions: true,
    events: true,
    eventCursor: 'sequence',
    structuredErrors: true,
  },
} as const;

const VALID_CAVE_HEALTH_RESPONSE = {
  apiVersion: '1.0',
  capabilities: ['health', 'pairing'],
  minimumClientVersion: '0.1.0',
  operations: ['health.read', 'pairing.create'],
  data: {
    instanceId: 'instance-1',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
} as const;

function createCovenHealthResponseWithEventCursor(eventCursor: string) {
  return {
    ...VALID_COVEN_HEALTH_RESPONSE,
    capabilities: {
      ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
      eventCursor,
    },
  };
}

function getAssessCompatibility(): CompatibilityAssessor {
  const assessCompatibility = (core as { assessCompatibility?: CompatibilityAssessor })
    .assessCompatibility;

  expect(assessCompatibility).toBeTypeOf('function');

  if (assessCompatibility === undefined) {
    throw new Error('assessCompatibility was not exported.');
  }

  return assessCompatibility;
}

describe('health validation', () => {
  test('exports strict SDK compatibility assessment primitives', () => {
    const assessCompatibility = getAssessCompatibility();

    expect(assessCompatibility('0.2.0', '0.10.0')).toEqual({
      compatible: true,
      minimumClientVersion: '0.2.0',
      clientVersion: '0.10.0',
    });
    expect(assessCompatibility('0.10.0', '0.2.0')).toEqual({
      compatible: false,
      minimumClientVersion: '0.10.0',
      clientVersion: '0.2.0',
    });
  });

  test('follows the SemVer prerelease precedence examples', () => {
    const assessCompatibility = getAssessCompatibility();

    for (let index = 0; index < SEMVER_PRECEDENCE_EXAMPLES.length - 1; index += 1) {
      const lower = SEMVER_PRECEDENCE_EXAMPLES[index];
      const higher = SEMVER_PRECEDENCE_EXAMPLES[index + 1];

      if (lower === undefined || higher === undefined) {
        throw new Error(`Missing SemVer precedence example around index ${index}.`);
      }

      expect(
        assessCompatibility(lower, higher).compatible,
        `${higher} should satisfy minimum ${lower}`,
      ).toBe(true);
      expect(
        assessCompatibility(higher, lower).compatible,
        `${lower} should not satisfy minimum ${higher}`,
      ).toBe(false);
    }
  });

  test('accepts alphanumeric prerelease identifiers that start with zero', () => {
    const assessCompatibility = getAssessCompatibility();

    expect(assessCompatibility('1.0.0-0', '1.0.0-0a')).toEqual({
      compatible: true,
      minimumClientVersion: '1.0.0-0',
      clientVersion: '1.0.0-0a',
    });
    expect(assessCompatibility('1.0.0-0a', '1.0.0-0').compatible).toBe(false);
  });

  test('rejects numeric prerelease identifiers with leading zeros', () => {
    const assessCompatibility = getAssessCompatibility();

    expect(() => assessCompatibility('1.0.0-01', '1.0.0-1')).toThrowError(
      'Invalid minimum client version semver: 1.0.0-01',
    );
    expect(() => assessCompatibility('1.0.0-1', '1.0.0-01')).toThrowError(
      'Invalid client version semver: 1.0.0-01',
    );
  });

  test('compares non-numeric prerelease identifiers by raw ASCII order', () => {
    const assessCompatibility = getAssessCompatibility();

    expect(assessCompatibility('1.0.0-A', '1.0.0-a').compatible).toBe(true);
    expect(assessCompatibility('1.0.0-a', '1.0.0-A').compatible).toBe(false);
  });

  test('compares huge numeric prerelease identifiers with arbitrary precision', () => {
    const assessCompatibility = getAssessCompatibility();

    expect(
      assessCompatibility('1.0.0-18446744073709551615', '1.0.0-18446744073709551616').compatible,
    ).toBe(true);
    expect(
      assessCompatibility(
        '1.0.0-1000000000000000000000000000000',
        '1.0.0-999999999999999999999999999999',
      ).compatible,
    ).toBe(false);
  });

  test('accepts Cave health responses when the minimum client version is compatible', async () => {
    const client = new CaveClient({
      transport: {
        health: () => Promise.resolve({
          ...VALID_CAVE_HEALTH_RESPONSE,
          minimumClientVersion: '0.0.0',
        }),
      },
    });

    await expect(client.health()).resolves.toEqual({
      status: 'ok',
      apiVersion: '1.0',
      minimumClientVersion: '0.0.0',
      capabilities: ['health', 'pairing'],
      operations: ['health.read', 'pairing.create'],
      instanceId: 'instance-1',
      pairingRequired: true,
      releaseVersion: '0.3.9',
    });
  });

  test('accepts compatible additive Cave fields and declarations', async () => {
    const client = new CaveClient({
      transport: {
        health: () =>
          Promise.resolve({
            apiVersion: '1.1',
            capabilities: ['health', 'future-safe-family'],
            minimumClientVersion: '0.1.0',
            operations: ['health.read', 'future.safe.read'],
            data: {
              instanceId: 'instance-2',
              pairingRequired: false,
              releaseVersion: '0.4.0',
              futureSafeField: true,
            },
            futureEnvelopeField: 'ignored',
          }),
      },
    });

    await expect(client.health()).resolves.toMatchObject({
      apiVersion: '1.1',
      capabilities: ['health', 'future-safe-family'],
      operations: ['health.read', 'future.safe.read'],
      instanceId: 'instance-2',
    });
  });

  test('never parses a proxy rejection as a Client v1 health envelope', async () => {
    const client = new CaveClient({
      transport: {
        health: () =>
          Promise.resolve({
            ok: false,
            reason: 'origin_not_allowed',
            error: 'Proxy rejected the request.',
          } as never),
      },
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'origin_not_allowed',
        operation: 'health',
        system: 'cave',
      },
    });
  });

  test('rejects Cave health responses that require a newer client version', async () => {
    const client = new CaveClient({
      transport: {
        health: () => Promise.resolve({
          ...VALID_CAVE_HEALTH_RESPONSE,
          minimumClientVersion: '999.0.0',
        }),
      },
    });

    const response = client.health();

    await expect(response).rejects.toBeInstanceOf(CaveClientError);
    await expect(response).rejects.toMatchObject({
      normalized: {
        system: 'cave',
        operation: 'health',
        code: 'incompatible_version',
        retryable: false,
      },
      compatibility: {
        compatible: false,
        minimumClientVersion: '999.0.0',
        clientVersion: cavePackageVersion,
      },
    });
  });

  test('accepts compatible additive Cave apiVersion updates on the same major version', async () => {
    const client = new CaveClient({
      transport: {
        health: () => Promise.resolve({
          ...VALID_CAVE_HEALTH_RESPONSE,
          apiVersion: '1.1',
        }),
      },
    });

    await expect(client.health()).resolves.toMatchObject({
      status: 'ok',
      apiVersion: '1.1',
      instanceId: 'instance-1',
    });
  });

  test('rejects incompatible Cave apiVersion major versions', async () => {
    const client = new CaveClient({
      transport: {
        health: () => Promise.resolve({
          ...VALID_CAVE_HEALTH_RESPONSE,
          apiVersion: '2.0',
        }),
      },
    });

    const response = client.health();

    await expect(response).rejects.toBeInstanceOf(CaveClientError);
    await expect(response).rejects.toMatchObject({
      normalized: {
        system: 'cave',
        operation: 'health',
        code: 'incompatible_version',
        retryable: false,
      },
    });
  });

  test.each([
    undefined,
    null,
    {},
    { data: {} },
    { data: null },
    { ...VALID_CAVE_HEALTH_RESPONSE, capabilities: 'health' },
    { ...VALID_CAVE_HEALTH_RESPONSE, capabilities: [] },
    { ...VALID_CAVE_HEALTH_RESPONSE, operations: [1] },
    { ...VALID_CAVE_HEALTH_RESPONSE, operations: [''] },
    { ...VALID_CAVE_HEALTH_RESPONSE, data: { pairingRequired: true } },
    { ...VALID_CAVE_HEALTH_RESPONSE, apiVersion: 'v1' },
    { ...VALID_CAVE_HEALTH_RESPONSE, apiVersion: 1 },
    { ...VALID_CAVE_HEALTH_RESPONSE, minimumClientVersion: 1 },
    { ...VALID_CAVE_HEALTH_RESPONSE, minimumClientVersion: 'not-semver' },
    { ...VALID_CAVE_HEALTH_RESPONSE, requestId: 1 },
  ])('normalizes invalid Cave health responses: %j', async (invalidResponse) => {
    const client = new CaveClient({
      transport: {
        health: () => Promise.resolve(invalidResponse as never),
      },
    });

    const response = client.health();

    await expect(response).rejects.toBeInstanceOf(CaveClientError);
    await expect(response).rejects.toMatchObject({
      normalized: {
        system: 'cave',
        operation: 'health',
        code: 'invalid_response',
        retryable: false,
      },
    });
  });

  test.each([
    undefined,
    null,
    {},
    { ok: true },
    { ...VALID_COVEN_HEALTH_RESPONSE, capabilities: [] },
    { ...VALID_COVEN_HEALTH_RESPONSE, capabilities: {} },
    {
      ...VALID_COVEN_HEALTH_RESPONSE,
      capabilities: {
        ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
        sessions: 'true',
      },
    },
    {
      ...VALID_COVEN_HEALTH_RESPONSE,
      capabilities: {
        ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
        events: 1,
      },
    },
    {
      ...VALID_COVEN_HEALTH_RESPONSE,
      capabilities: {
        ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
        eventCursor: ['sequence'],
      },
    },
    {
      ...VALID_COVEN_HEALTH_RESPONSE,
      capabilities: {
        ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
        structuredErrors: false,
      },
    },
    {
      ...VALID_COVEN_HEALTH_RESPONSE,
      capabilities: {
        ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
        structuredErrors: null,
      },
    },
    {
      ...VALID_COVEN_HEALTH_RESPONSE,
      capabilities: {
        sessions: true,
        events: true,
        eventCursor: 'sequence',
      },
    },
  ])(
    'normalizes invalid Coven health responses: %j',
    async (invalidResponse) => {
      const client = new CovenClient({
        transport: {
          health: () => Promise.resolve(invalidResponse as never),
        },
      });

      const response = client.health();

      await expect(response).rejects.toBeInstanceOf(CovenClientError);
      await expect(response).rejects.toMatchObject({
        normalized: {
          system: 'coven',
          operation: 'health',
          code: 'invalid_response',
          retryable: false,
        },
      });
    },
  );

  test('still accepts valid Coven health responses', async () => {
    const client = new CovenClient({
      transport: {
        health: () => Promise.resolve(VALID_COVEN_HEALTH_RESPONSE),
      },
    });

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
  });

  test('accepts finalized Coven health responses without eventCursor', async () => {
    const capabilitiesWithoutEventCursor = {
      ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
    };
    Reflect.deleteProperty(capabilitiesWithoutEventCursor, 'eventCursor');
    const client = new CovenClient({
      transport: {
        health: () =>
          Promise.resolve({
            ...VALID_COVEN_HEALTH_RESPONSE,
            capabilities: capabilitiesWithoutEventCursor,
          }),
      },
    });

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
  });

  test.each(['sequence', 'offset', 'stream'])(
    'accepts string-typed Coven eventCursor values from compatible transports: %s',
    async (eventCursor) => {
      const compatibleEventCursor: string = eventCursor;
      const client = new CovenClient({
        transport: {
          health: () =>
            Promise.resolve(createCovenHealthResponseWithEventCursor(compatibleEventCursor)),
        },
      });

      await expect(client.health()).resolves.toEqual({ status: 'ok' });
    },
  );

  test('rejects non-string Coven eventCursor values at runtime', async () => {
    const client = new CovenClient({
      transport: {
        health: () =>
          Promise.resolve({
            ...VALID_COVEN_HEALTH_RESPONSE,
            capabilities: {
              ...VALID_COVEN_HEALTH_RESPONSE.capabilities,
              eventCursor: 1,
            },
          } as never),
      },
    });

    const response = client.health();

    await expect(response).rejects.toBeInstanceOf(CovenClientError);
    await expect(response).rejects.toMatchObject({
      normalized: {
        system: 'coven',
        operation: 'health',
        code: 'invalid_response',
        retryable: false,
      },
    });
  });
});
