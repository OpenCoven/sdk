import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import {
  parseCaveContractAuthorityArguments,
  verifyCaveContractAuthority,
} from '../scripts/verify-cave-contract-authority.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratchRoots: string[] = [];

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

afterEach(() => {
  while (scratchRoots.length > 0) {
    const scratchRoot = scratchRoots.pop();
    if (scratchRoot !== undefined) {
      rmSync(scratchRoot, { force: true, recursive: true });
    }
  }
});

describe('Cave contract provenance', () => {
  test('accepts the pnpm argument separator for explicit parity checks', () => {
    expect(
      parseCaveContractAuthorityArguments(['--', '--cave-root', '/tmp/coven-cave']),
    ).toEqual({
      caveRoot: '/tmp/coven-cave',
      allowEquivalentHead: false,
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
      commit: '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
      fixturePath: 'src/lib/server/client-v1/contract-fixture.json',
      digestPath: 'src/lib/server/client-v1/contract-fixture.sha256',
      sha256: '1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d',
      vectorPath: 'src/lib/server/client-v1/hpke-bound-v1-vectors.json',
      vectorDigestPath: 'src/lib/server/client-v1/hpke-bound-v1-vectors.sha256',
      vectorSha256: 'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
    });
  });

  test('proves an explicit authority checkout has the reviewed fixture bytes', () => {
    const caveRoot = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-authority-'));
    scratchRoots.push(caveRoot);
    const fixture = readFileSync(
      resolve(root, 'packages/cave/fixtures/contract-fixture.json'),
    );
    const fixturePath = resolve(
      caveRoot,
      'src/lib/server/client-v1/contract-fixture.json',
    );
    const digestPath = resolve(
      caveRoot,
      'src/lib/server/client-v1/contract-fixture.sha256',
    );
    const vector = readFileSync(
      resolve(root, 'packages/cave/fixtures/hpke-bound-v1-vectors.json'),
    );
    const vectorPath = resolve(
      caveRoot,
      'src/lib/server/client-v1/hpke-bound-v1-vectors.json',
    );
    const vectorDigestPath = resolve(
      caveRoot,
      'src/lib/server/client-v1/hpke-bound-v1-vectors.sha256',
    );
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, fixture);
    writeFileSync(digestPath, `${sha256(fixture)}\n`);
    writeFileSync(vectorPath, vector);
    writeFileSync(vectorDigestPath, `${sha256(vector)}\n`);

    expect(
      verifyCaveContractAuthority({
        caveRoot,
        expectedCommit: '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
        resolveCommit: () => '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
      }),
    ).toEqual({
      commit: '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
      checkoutCommit: '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
      sha256: '1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d',
      vectorSha256: 'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
    });
  });

  test('accepts an explicitly allowed content-equivalent feature head', () => {
    const caveRoot = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-equivalent-'));
    scratchRoots.push(caveRoot);
    const fixture = readFileSync(
      resolve(root, 'packages/cave/fixtures/contract-fixture.json'),
    );
    const vector = readFileSync(
      resolve(root, 'packages/cave/fixtures/hpke-bound-v1-vectors.json'),
    );
    for (const [name, bytes] of [
      ['contract-fixture.json', fixture],
      ['hpke-bound-v1-vectors.json', vector],
    ] as const) {
      const path = resolve(caveRoot, 'src/lib/server/client-v1', name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      writeFileSync(
        path.replace(/\.json$/u, '.sha256'),
        `${sha256(bytes)}\n`,
      );
    }

    expect(
      verifyCaveContractAuthority({
        caveRoot,
        allowEquivalentHead: true,
        resolveCommit: () => '0453bfa8d4cae1b7bca01a43ed08349fcdd39de9',
        isEquivalentCommit: () => true,
      }),
    ).toEqual({
      commit: '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
      checkoutCommit: '0453bfa8d4cae1b7bca01a43ed08349fcdd39de9',
      sha256: '1b78125dab5b77414efd2d34e13315f542b197715ed26c6521f588e299abe61d',
      vectorSha256: 'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
    });
  });

  test('parses the explicit equivalent-head CLI gate', () => {
    expect(
      parseCaveContractAuthorityArguments([
        '--',
        '--cave-root',
        '/tmp/coven-cave',
        '--allow-equivalent-head',
      ]),
    ).toEqual({
      caveRoot: '/tmp/coven-cave',
      allowEquivalentHead: true,
    });
  });

  test('rejects an authority checkout at any other commit', () => {
    expect(() =>
      verifyCaveContractAuthority({
        caveRoot: '/tmp/not-read',
        resolveCommit: () => '0000000000000000000000000000000000000000',
      }),
    ).toThrowError(/expected 2a0ff9237e94e652e477b22f60fd6d721b9e6451/u);
  });
});
