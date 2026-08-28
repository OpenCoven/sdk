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
const legacyFixturePath = resolve(
  root,
  'tests/fixtures/cave-contract-fixture-v1.json',
);

describe('Cave contract fixture parsing', () => {
  test('parses the exact legacy Client v1 fixture without HPKE extensions', () => {
    const legacyFixture = readFileSync(legacyFixturePath, 'utf8');
    const parsed = parseCaveContractFixture(legacyFixture);

    expect(digestCaveContractFixture(legacyFixture)).toBe(
      'b2694cd1a70a2ddd81b54ee43ade1ff5aa1ecd661fa6e41e5b7acedd8db400bd',
    );
    expect(parsed.contract).not.toHaveProperty('authority');
    expect(parsed.contract.discovery).toEqual({
      fileName: 'client-v1-discovery.json',
      mode: '0600',
      version: 1,
    });
    expect(parsed.contract.operations[0]).not.toHaveProperty('binding');
    expect(parsed.contract.operations[0]).not.toHaveProperty('credential');
    expect(parsed.examples).not.toHaveProperty('discoveryRecordV2');
  });

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
          hpkeBoundVersion: 2,
          mode: '0600',
          version: 1,
        },
        authority: {
          defaultMode: 'off',
          modes: ['off', 'advertise', 'enforce'],
          mechanism: {
            id: 'hpke-bound-v1',
            discoveryVersion: 2,
            suite: {
              kemId: 32,
              kdfId: 1,
              aeadId: 2,
            },
            requestHeaders: {
              mechanism: 'x-coven-client-v1-authority',
              keyId: 'x-coven-client-v1-authority-key-id',
              instanceId: 'x-coven-client-v1-authority-instance',
              runtimeNonce: 'x-coven-client-v1-authority-runtime-nonce',
              requestNonce: 'x-coven-client-v1-authority-request-nonce',
              issuedAt: 'x-coven-client-v1-authority-issued-at',
              enc: 'x-coven-client-v1-authority-enc',
              ciphertext: 'x-coven-client-v1-authority-ciphertext',
            },
            protectedOperations: [
              'pairing.poll',
              'pairing.exchange',
              'familiars.list',
              'projects.list',
              'conversations.list',
              'conversations.read',
              'messages.list',
            ],
            vectorFixture: {
              fileName: 'hpke-bound-v1-vectors.json',
              sha256FileName: 'hpke-bound-v1-vectors.sha256',
            },
          },
        },
        errorCodes: [
          'invalid_request',
          'unauthorized',
          'scope_denied',
          'not_found',
          'conflict',
          'rate_limited',
          'pairing_pending',
          'pairing_denied',
          'pairing_expired',
          'incompatible_version',
          'service_unavailable',
          'reconcile_required',
          'internal_error',
        ],
        minimumClientVersion: '0.1.0',
        pairingRequired: true,
        pairingSecretHeader: 'x-coven-pairing-secret',
        limits: {
          cursorCharacters: 512,
          defaultPageSize: 50,
          errorDetailEntries: 16,
          errorDetailValueCharacters: 256,
          errorMessageCharacters: 256,
          maxPageSize: 100,
          requestIdCharacters: 64,
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
      binding: 'none',
      credential: 'none',
      ingress: 'public',
      method: 'GET',
      path: '/api/client/v1/health',
      scope: null,
    }));
    expect(parsed.contract.operations).toContainEqual(expect.objectContaining({
      id: 'pairing.exchange',
      binding: 'hpke-bound-v1',
      credential: 'pairing-secret',
    }));
    expect(parsed.contract.operations).toContainEqual(expect.objectContaining({
      id: 'familiars.list',
      binding: 'hpke-bound-v1',
      credential: 'bearer',
    }));
    expect(parsed.examples.discoveryRecordV2).toEqual({
      version: 2,
      endpoint: 'http://127.0.0.1:3020',
      pid: 4321,
      nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8',
      startedAt: '2026-08-25T15:42:58.109Z',
      authority: {
        mechanism: 'hpke-bound-v1',
        mode: 'advertise',
        keyId: 'Tq04GMSX5BPPPijzO9pHfQ1lAnna_RQKzL1ncDGl-4g',
        publicKey: 'sfG4QN56MkGwJ0jPmwW3TcjF6EUSmHOIF712qo6-jCs',
        suite: {
          kemId: 32,
          kdfId: 1,
          aeadId: 2,
        },
      },
    });
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

  test.each([
    ['authority declaration', (fixture: Record<string, unknown>) => {
      delete (fixture.contract as Record<string, unknown>).authority;
    }],
    ['discovery version', (fixture: Record<string, unknown>) => {
      delete (
        (fixture.contract as Record<string, unknown>)
          .discovery as Record<string, unknown>
      ).hpkeBoundVersion;
    }],
    ['operation binding', (fixture: Record<string, unknown>) => {
      delete (
        (
          (fixture.contract as Record<string, unknown>)
            .operations as Record<string, unknown>[]
        )[0] as Record<string, unknown>
      ).binding;
    }],
    ['v2 example', (fixture: Record<string, unknown>) => {
      delete (fixture.examples as Record<string, unknown>).discoveryRecordV2;
    }],
  ])('rejects a partial HPKE fixture extension missing %s', (_label, mutate) => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<
      string,
      unknown
    >;
    mutate(fixture);

    expect(() => parseCaveContractFixture(fixture)).toThrow(TypeError);
  });
});
