import { describe, expect, test } from 'vitest';

import { DEV_CLI_VERSION, runCli } from '@opencoven/dev-cli';

describe('opencoven CLI behavior', () => {
  test('emits the documented JSON help output', async () => {
    const result = await runCli(['--json', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'help',
      data: {
        name: 'opencoven',
      },
      ok: true,
      version: DEV_CLI_VERSION,
    });
  });

  test('writes human command failures to stderr', async () => {
    const result = await runCli(['status']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('This command is reserved for a future operational task.\n');
  });

  test('keeps JSON command failures machine-readable on stdout', async () => {
    const result = await runCli(['--json', 'status']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'status',
      error: {
        code: 'not_implemented',
      },
      ok: false,
    });
  });
});
