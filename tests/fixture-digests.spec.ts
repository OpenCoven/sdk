import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function digest(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('reviewed authority fixtures', () => {
  test('copies the approved Cave contract and HPKE vector bytes and digests', () => {
    const fixture = resolve(root, 'packages/cave/fixtures/contract-fixture.json');
    const digestFile = resolve(root, 'packages/cave/fixtures/contract-fixture.sha256');
    const vector = resolve(root, 'packages/cave/fixtures/hpke-bound-v1-vectors.json');
    const vectorDigestFile = resolve(
      root,
      'packages/cave/fixtures/hpke-bound-v1-vectors.sha256',
    );
    const parsed = JSON.parse(readFileSync(fixture, 'utf8')) as {
      contract: {
        authority: {
          mechanism: {
            vectorFixture: {
              fileName: string;
              sha256FileName: string;
            };
          };
        };
        identityKinds: string[];
      };
      examples: Record<string, unknown>;
    };

    expect(digest(fixture)).toBe('1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d');
    expect(readFileSync(digestFile, 'utf8')).toBe('1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d\n');
    expect(digest(vector)).toBe('f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797');
    expect(readFileSync(vectorDigestFile, 'utf8')).toBe(
      'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797\n',
    );
    expect(parsed.contract.authority.mechanism.vectorFixture).toEqual({
      fileName: 'hpke-bound-v1-vectors.json',
      sha256FileName: 'hpke-bound-v1-vectors.sha256',
    });
    expect(parsed.contract.identityKinds).toEqual([
      'client',
      'credential',
      'familiar',
      'project',
      'conversation',
      'message',
      'event',
    ]);
    expect(Object.keys(parsed.examples)).toEqual([
      'cursor',
      'discoveryRecord',
      'discoveryRecordV2',
      'errorEnvelope',
      'health',
      'healthEnvelope',
      'identity',
      'pairingCreatedEnvelope',
      'pairingExchangeEnvelope',
      'pairingStatusEnvelope',
      'revision',
      'status',
      'successEnvelope',
    ]);
  });

  test('copies the approved Coven health fixture bytes', () => {
    expect(digest(resolve(root, 'packages/coven/fixtures/health.json'))).toBe(
      '6d339c0796df124579a01debf1f30ac82ad09bc2e68b734b935e3e0e6c19154f',
    );
  });

  test('copies the approved Coven error fixture bytes', () => {
    expect(digest(resolve(root, 'packages/coven/fixtures/error.json'))).toBe(
      '927bfe212e75d6e213780a79e1657033c577c68cdd4119f19ccec944337457c4',
    );
  });
});
