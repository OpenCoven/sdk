import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverManagedCaveEndpoint,
  type CaveManagedDiscoverySource,
} from '@opencoven/cave-client/managed';
import { describe, expect, test } from 'vitest';

import { parseCaveDiscoveryRecord } from '../packages/cave/src/discovery-record.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = JSON.parse(
  readFileSync(
    resolve(root, 'packages/cave/fixtures/contract-fixture.json'),
    'utf8',
  ),
) as {
  examples: {
    discoveryRecord: Record<string, unknown>;
    discoveryRecordV2: Record<string, unknown>;
  };
};

function v2Record(): Record<string, unknown> {
  return structuredClone(fixture.examples.discoveryRecordV2);
}

function managedSource(record: Record<string, unknown>): CaveManagedDiscoverySource {
  return {
    read: async () => ({
      bytes: `${JSON.stringify(record)}\n`,
      record: {
        identity: 'native:owner-checked:client-v1-discovery',
        device: 7,
        inode: 11,
        processAlive: true,
      },
    }),
  };
}

describe('Cave HPKE discovery v2', () => {
  test('continues accepting discovery v1 unchanged', async () => {
    await expect(
      parseCaveDiscoveryRecord(
        JSON.stringify(fixture.examples.discoveryRecord),
        () => true,
      ),
    ).resolves.toEqual({
      version: 1,
      endpoint: {
        kind: 'http',
        url: 'http://127.0.0.1:3020',
      },
      freshness: {
        pid: 4321,
        nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
        startedAt: '2026-08-20T20:20:12.617Z',
      },
    });
  });

  test('parses and freezes exact discovery v2 authority metadata', async () => {
    const parsed = await parseCaveDiscoveryRecord(
      JSON.stringify(v2Record()),
      () => true,
    );

    expect(parsed).toEqual({
      version: 2,
      endpoint: {
        kind: 'http',
        url: 'http://127.0.0.1:3020',
      },
      freshness: {
        pid: 4321,
        nonce: 'gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8',
        startedAt: '2026-08-25T15:42:58.109Z',
      },
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
    expect(parsed.version).toBe(2);
    if (parsed.version !== 2) {
      throw new Error('Expected discovery v2.');
    }
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.authority)).toBe(true);
    expect(Object.isFrozen(parsed.authority.suite)).toBe(true);
  });

  test.each([
    ['top-level extra field', (record: Record<string, unknown>) => {
      record.extra = true;
    }],
    ['authority extra field', (record: Record<string, unknown>) => {
      (record.authority as Record<string, unknown>).extra = true;
    }],
    ['suite extra field', (record: Record<string, unknown>) => {
      ((record.authority as Record<string, unknown>).suite as Record<string, unknown>).extra = true;
    }],
    ['off mode', (record: Record<string, unknown>) => {
      (record.authority as Record<string, unknown>).mode = 'off';
    }],
    ['wrong mechanism', (record: Record<string, unknown>) => {
      (record.authority as Record<string, unknown>).mechanism = 'hpke-bound-v2';
    }],
    ['wrong KEM', (record: Record<string, unknown>) => {
      ((record.authority as Record<string, unknown>).suite as Record<string, unknown>).kemId = 16;
    }],
    ['padded runtime nonce', (record: Record<string, unknown>) => {
      record.nonce = `${String(record.nonce)}=`;
    }],
    ['short public key', (record: Record<string, unknown>) => {
      (record.authority as Record<string, unknown>).publicKey = 'AA';
    }],
    ['mismatched key id', (record: Record<string, unknown>) => {
      (record.authority as Record<string, unknown>).keyId =
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    }],
  ])('rejects v2 records with %s', async (_label, mutate) => {
    const record = v2Record();
    mutate(record);

    await expect(
      parseCaveDiscoveryRecord(JSON.stringify(record), () => true),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  test('returns the same strict immutable authority metadata through managed discovery', async () => {
    const discovered = await discoverManagedCaveEndpoint(
      managedSource(v2Record()),
    );

    expect(discovered).toMatchObject({
      version: 2,
      authority: {
        mechanism: 'hpke-bound-v1',
        mode: 'advertise',
        suite: {
          kemId: 32,
          kdfId: 1,
          aeadId: 2,
        },
      },
    });
    expect(discovered.version).toBe(2);
    if (discovered.version !== 2) {
      throw new Error('Expected managed discovery v2.');
    }
    expect(Object.isFrozen(discovered)).toBe(true);
    expect(Object.isFrozen(discovered.authority)).toBe(true);
    expect(Object.isFrozen(discovered.authority.suite)).toBe(true);
  });
});
