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
        '  opencoven diagnostics [--json]',
        '  opencoven completions <bash|zsh|fish|powershell>',
        '  opencoven scaffold <cave-chat|coven-observer|unified-status> <directory> [--force]',
        '',
        'This CLI owns the opencoven binary.',
        '',
        'Diagnostics report versions and capabilities only. They exclude prompts,',
        'tokens, attachments, and event payloads.',
        '',
        'Scaffolds refuse to overwrite existing files unless --force is given.',
        'Browser applications cannot connect to Cave or Coven directly in v1; run a',
        'scaffold in a server-side runtime and let the browser talk to that.',
        '',
      ].join('\n'),
    });
  });

  test('states the v1 browser limitation where the CLI is used, not only in a README', async () => {
    const help = await runCli(['--help']);

    expect(help.stdout).toContain(
      'Browser applications cannot connect to Cave or Coven directly in v1',
    );
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
