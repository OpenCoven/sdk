import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main, runCli } from '@opencoven/dev-cli';
import { describe, expect, test, vi } from 'vitest';

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

  test('returns stable human and JSON version output', async () => {
    await expect(runCli(['--version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `${cliVersion}\n`,
    });

    const json = await runCli(['--json', '--version']);

    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      command: 'version',
      ok: true,
      version: cliVersion,
    });
  });

  test('returns stable unsupported-command errors', async () => {
    await expect(runCli(['sessions', 'list'])).resolves.toEqual({
      exitCode: 1,
      stderr: 'This command is reserved for a future operational task.\n',
      stdout: '',
    });

    const json = await runCli(['--json', '--unknown']);

    expect(json.exitCode).toBe(1);
    expect(JSON.parse(json.stdout)).toEqual({
      command: 'opencoven',
      error: {
        code: 'not_implemented',
        message: 'This command is reserved for a future operational task.',
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('writes CLI output through the process entry point', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(main(['--version'])).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith(`${cliVersion}\n`);

    stdout.mockRestore();
  });
});
