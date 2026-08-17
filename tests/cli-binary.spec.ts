import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const binary = resolve(root, 'packages/cli/dist/bin.js');

describe('opencoven binary', () => {
  test('emits the documented JSON help output', () => {
    const result = existsSync(binary)
      ? spawnSync(process.execPath, [binary, '--json', '--help'], {
          cwd: root,
          encoding: 'utf8',
        })
      : { status: 1, stdout: '', stderr: 'CLI binary is missing' };

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'help',
      data: {
        name: 'opencoven',
      },
      ok: true,
      version: '0.1.0',
    });
  });
});
