import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const verifier = resolve(root, 'scripts/verify-package.mjs');

describe('packed public packages', () => {
  test('pack, install, import, and compile only their public exports', () => {
    const result = existsSync(verifier)
      ? spawnSync(process.execPath, [verifier], {
          cwd: root,
          encoding: 'utf8',
        })
      : { status: 1, stderr: 'scripts/verify-package.mjs is missing' };

    expect(result.status, result.stderr).toBe(0);
  }, 30_000);
});
