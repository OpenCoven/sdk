import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const verifier = resolve(root, 'scripts/verify-contracts.mjs');

describe('contract verifier', () => {
  test('checks copied authority fixture digests without importing authority source', () => {
    const result = existsSync(verifier)
      ? spawnSync(process.execPath, [verifier], {
          cwd: root,
          encoding: 'utf8',
        })
      : { status: 1, stderr: 'scripts/verify-contracts.mjs is missing' };

    expect(result.status, result.stderr).toBe(0);
  });
});
