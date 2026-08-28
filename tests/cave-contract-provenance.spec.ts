import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  parseCaveContractAuthorityArguments,
  verifyCaveContractAuthority,
} from '../scripts/verify-cave-contract-authority.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CAVE_MERGE = '1d16736e637de384ebf7423c05862d66860478c4';
const CAVE_FEATURE_HEAD = 'ae131bfd370b832389204ee2b8c7ae8867581215';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function authorityFiles(): ReadonlyMap<string, Buffer> {
  const fixture = readFileSync(
    resolve(root, 'packages/cave/fixtures/contract-fixture.json'),
  );
  const vector = readFileSync(
    resolve(root, 'packages/cave/fixtures/hpke-bound-v1-vectors.json'),
  );
  return new Map([
    ['src/lib/server/client-v1/contract-fixture.json', fixture],
    [
      'src/lib/server/client-v1/contract-fixture.sha256',
      Buffer.from(`${sha256(fixture)}\n`),
    ],
    ['src/lib/server/client-v1/hpke-bound-v1-vectors.json', vector],
    [
      'src/lib/server/client-v1/hpke-bound-v1-vectors.sha256',
      Buffer.from(`${sha256(vector)}\n`),
    ],
  ]);
}

describe('Cave contract provenance', () => {
  test('accepts the pnpm argument separator for explicit parity checks', () => {
    expect(
      parseCaveContractAuthorityArguments(['--', '--cave-root', '/tmp/coven-cave']),
    ).toEqual({
      caveRoot: '/tmp/coven-cave',
      sourceCommit: undefined,
    });
  });

  test('pins the reviewed producer commit, path, and fixture digest', () => {
    const provenance = JSON.parse(
      readFileSync(
        resolve(root, 'packages/cave/fixtures/contract-fixture.provenance.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(provenance).toEqual({
      repository: 'https://github.com/OpenCoven/coven-cave',
      commit: CAVE_MERGE,
      fixturePath: 'src/lib/server/client-v1/contract-fixture.json',
      digestPath: 'src/lib/server/client-v1/contract-fixture.sha256',
      sha256: '1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d',
      vectorPath: 'src/lib/server/client-v1/hpke-bound-v1-vectors.json',
      vectorDigestPath: 'src/lib/server/client-v1/hpke-bound-v1-vectors.sha256',
      vectorSha256: 'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
    });
  });

  test('proves an exact authority commit has the reviewed fixture bytes', () => {
    const files = authorityFiles();

    expect(
      verifyCaveContractAuthority({
        caveRoot: '/not-read',
        expectedCommit: CAVE_MERGE,
        resolveCommit: () => CAVE_MERGE,
        readCommitFile: (_caveRoot, commit, path) => {
          expect(commit).toBe(CAVE_MERGE);
          const bytes = files.get(path);
          if (bytes === undefined) {
            throw new Error(`Unexpected authority path ${path}.`);
          }
          return bytes;
        },
      }),
    ).toEqual({
      commit: CAVE_MERGE,
      checkoutCommit: CAVE_MERGE,
      sha256: '1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d',
      vectorSha256: 'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
    });
  });

  test('reads the pinned merge tree from a repository at a different head', () => {
    const files = authorityFiles();

    expect(
      verifyCaveContractAuthority({
        caveRoot: '/not-read',
        sourceCommit: CAVE_MERGE,
        resolveCommit: () => CAVE_FEATURE_HEAD,
        readCommitFile: (_caveRoot, commit, path) => {
          expect(commit).toBe(CAVE_MERGE);
          const bytes = files.get(path);
          if (bytes === undefined) {
            throw new Error(`Unexpected authority path ${path}.`);
          }
          return bytes;
        },
      }),
    ).toEqual({
      commit: CAVE_MERGE,
      checkoutCommit: CAVE_FEATURE_HEAD,
      sha256: '1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d',
      vectorSha256: 'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
    });
  });

  test('parses an explicit exact authority commit', () => {
    expect(
      parseCaveContractAuthorityArguments([
        '--',
        '--cave-root',
        '/tmp/coven-cave',
        '--commit',
        CAVE_MERGE,
      ]),
    ).toEqual({
      caveRoot: '/tmp/coven-cave',
      sourceCommit: CAVE_MERGE,
    });
  });

  test('rejects an unpinned authority commit', () => {
    expect(() =>
      verifyCaveContractAuthority({
        caveRoot: '/tmp/not-read',
        sourceCommit: '0000000000000000000000000000000000000000',
        resolveCommit: () => CAVE_FEATURE_HEAD,
      }),
    ).toThrowError(new RegExp(`expected ${CAVE_MERGE}`, 'u'));
  });
});
