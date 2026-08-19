import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from '@opencoven/dev-cli';
import { describe, expect, test } from 'vitest';

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliVersion = (
  JSON.parse(readFileSync(resolve(workspaceRoot, 'packages/cli/package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('opencoven CLI output', () => {
  test('returns stable human-readable help without touching local services', async () => {
    await expect(runCli([])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: [
        'OpenCoven developer CLI',
        '',
        'Usage:',
        '  opencoven [--help] [--version] [--json]',
        '',
        'This CLI owns the opencoven binary.',
        '',
      ].join('\n'),
    });
  });

  test('returns stable JSON help', async () => {
    const result = await runCli(['--json', '--help']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'help',
      data: {
        name: 'opencoven',
      },
      ok: true,
      version: cliVersion,
    });
  });
});
