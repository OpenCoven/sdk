import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  digestCaveContractFixture,
  parseCaveContractFixture,
  parseVerifiedCaveContractFixture,
} from '@opencoven/cave-client';
import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturePath = resolve(root, 'packages/cave/fixtures/contract-fixture.json');
const digestPath = resolve(root, 'packages/cave/fixtures/contract-fixture.sha256');

describe('Cave contract fixture parsing', () => {
  test('parses the reviewed fixture through the public package entry point', () => {
    const fixture = readFileSync(fixturePath, 'utf8');
    const digest = readFileSync(digestPath, 'utf8');

    const parsed = parseVerifiedCaveContractFixture(fixture, digest);

    expect(parsed).toMatchObject({
      contract: {
        apiVersion: '1.0',
        capabilities: [
          'health',
          'pairing',
          'credentials',
          'familiars',
          'projects',
          'conversations',
          'conversation-messages',
          'cursors',
        ],
        discovery: {
          fileName: 'client-v1-discovery.json',
          mode: '0600',
          version: 1,
        },
        minimumClientVersion: '0.1.0',
        pairingRequired: true,
        pairingSecretHeader: 'x-coven-pairing-secret',
        limits: {
          cursorCharacters: 512,
          defaultPageSize: 50,
          maxPageSize: 100,
        },
      },
      examples: {
        healthEnvelope: {
          data: {
            instanceId: '00000000-0000-4000-8000-000000000000',
            pairingRequired: true,
            releaseVersion: '0.0.0',
          },
        },
      },
    });
    expect(parsed.contract.operations).toContainEqual(expect.objectContaining({
      id: 'health.read',
      ingress: 'public',
      method: 'GET',
      path: '/api/client/v1/health',
      scope: null,
    }));
    expect(parsed.examples.healthEnvelope.operations).toEqual(
      parsed.contract.operations.map(({ id }) => id),
    );
  });

  test('rejects a required-field mutation when the digest is left stale', () => {
    const fixture = readFileSync(fixturePath, 'utf8');
    const digest = readFileSync(digestPath, 'utf8');
    const mutatedFixture = parseCaveContractFixture(fixture) as unknown as {
      contract: Record<string, unknown>;
    };

    delete mutatedFixture.contract.minimumClientVersion;

    const staleFixtureBytes = `${JSON.stringify(mutatedFixture, null, 2)}\n`;

    expect(() => parseVerifiedCaveContractFixture(staleFixtureBytes, digest)).toThrowError(
      /Cave fixture digest mismatch/u,
    );
  });

  test('rejects a required-field mutation even when the digest is recomputed', () => {
    const fixture = readFileSync(fixturePath, 'utf8');
    const mutatedFixture = parseCaveContractFixture(fixture) as unknown as {
      contract: Record<string, unknown>;
    };

    delete mutatedFixture.contract.minimumClientVersion;

    const mutatedFixtureBytes = `${JSON.stringify(mutatedFixture, null, 2)}\n`;
    const mutatedDigest = digestCaveContractFixture(mutatedFixtureBytes);

    expect(() =>
      parseVerifiedCaveContractFixture(mutatedFixtureBytes, `${mutatedDigest}\n`),
    ).toThrowError('fixture.contract.minimumClientVersion must be a string.');
  });

  test('accepts object inputs and rejects invalid object field types', () => {
    const fixture = parseCaveContractFixture(readFileSync(fixturePath, 'utf8'));

    expect(parseCaveContractFixture(fixture as unknown as Record<string, unknown>)).toEqual(fixture);

    const invalidStatus = structuredClone(fixture) as unknown as {
      examples: {
        status: {
          status: string;
        };
      };
    };
    invalidStatus.examples.status.status = 'broken';
    expect(() =>
      parseCaveContractFixture(invalidStatus as unknown as Record<string, unknown>),
    ).toThrowError(
      'fixture.examples.status.status must be "ok".',
    );

    const invalidCapabilities = structuredClone(fixture) as unknown as {
      examples: {
        successEnvelope: {
          capabilities: unknown;
        };
      };
    };
    invalidCapabilities.examples.successEnvelope.capabilities = 'not-an-array';
    expect(() =>
      parseCaveContractFixture(invalidCapabilities as Record<string, unknown>),
    ).toThrowError(
      'fixture.examples.successEnvelope.capabilities must be an array.',
    );
  });

  test('rejects invalid digest formats before parsing fixture bytes', () => {
    const fixture = readFileSync(fixturePath, 'utf8');

    expect(() => parseVerifiedCaveContractFixture(fixture, 'ABC123')).toThrowError(
      'Cave fixture digest must be a lowercase hexadecimal SHA-256 string.',
    );
  });

  test('accepts safe additive fixture fields without weakening required fields', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      contract: Record<string, unknown>;
      examples: {
        health: Record<string, unknown>;
      };
    };
    fixture.contract.futureDeclaration = { enabled: true };
    fixture.examples.health.futureMetadata = 'compatible';

    expect(parseCaveContractFixture(fixture)).toMatchObject({
      contract: {
        apiVersion: '1.0',
      },
      examples: {
        health: {
          instanceId: '00000000-0000-4000-8000-000000000000',
        },
      },
    });
  });
});
