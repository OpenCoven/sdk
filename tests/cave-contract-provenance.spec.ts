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
      commit: '53cd5bf0986a6df92f66dc6622441c74e31af5db',
      fixturePath: 'src/lib/server/client-v1/contract-fixture.json',
      digestPath: 'src/lib/server/client-v1/contract-fixture.sha256',
      sha256: '806d647f5969e646080713dabaa9d86ac897637e2a823c75085093c5a210a7fe',
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
        expectedCommit: '53cd5bf0986a6df92f66dc6622441c74e31af5db',
        resolveCommit: () => '53cd5bf0986a6df92f66dc6622441c74e31af5db',
      }),
    ).toEqual({
      commit: '53cd5bf0986a6df92f66dc6622441c74e31af5db',
      sha256: '806d647f5969e646080713dabaa9d86ac897637e2a823c75085093c5a210a7fe',
    });
  });

  test('rejects an authority checkout at any other commit', () => {
    expect(() =>
      verifyCaveContractAuthority({
        caveRoot: '/tmp/not-read',
        resolveCommit: () => '0000000000000000000000000000000000000000',
      }),
    ).toThrowError(/expected 53cd5bf0986a6df92f66dc6622441c74e31af5db/u);
  });
});
