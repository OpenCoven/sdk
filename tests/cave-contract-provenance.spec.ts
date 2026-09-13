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
      commit: 'e806655a7100e9d589662a6f3817c3fd8cde48ad',
      fixturePath: 'src/lib/server/client-v1/contract-fixture.json',
      digestPath: 'src/lib/server/client-v1/contract-fixture.sha256',
      sha256: '0c03baea9c21f0985df41eef3c5ae5223497b9081c665b53ddecab36598f5ede',
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
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, fixture);
    writeFileSync(digestPath, `${sha256(fixture)}\n`);

    expect(
      verifyCaveContractAuthority({
        caveRoot,
        expectedCommit: 'e806655a7100e9d589662a6f3817c3fd8cde48ad',
        resolveCommit: () => 'e806655a7100e9d589662a6f3817c3fd8cde48ad',
      }),
    ).toEqual({
      commit: 'e806655a7100e9d589662a6f3817c3fd8cde48ad',
      sha256: '0c03baea9c21f0985df41eef3c5ae5223497b9081c665b53ddecab36598f5ede',
    });
  });

  test('rejects an authority checkout at any other commit', () => {
    expect(() =>
      verifyCaveContractAuthority({
        caveRoot: '/tmp/not-read',
        resolveCommit: () => '0000000000000000000000000000000000000000',
      }),
    ).toThrowError(/expected e806655a7100e9d589662a6f3817c3fd8cde48ad/u);
  });
});
