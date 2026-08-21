import {
  CLI_COMMANDS,
  CLI_FLAGS,
  COMPLETION_SHELLS,
  DEV_CLI_VERSION,
  isCompletionShell,
  renderCompletionScript,
  runCli,
  SCAFFOLD_TEMPLATES,
  type CompletionShell,
} from '@opencoven/dev-cli';
import { describe, expect, test } from 'vitest';

describe('opencoven completions', () => {
  test('supports exactly the four documented shells', () => {
    expect([...COMPLETION_SHELLS]).toEqual(['bash', 'zsh', 'fish', 'powershell']);
    expect(isCompletionShell('bash')).toBe(true);
    expect(isCompletionShell('nushell')).toBe(false);
  });

  test.each(COMPLETION_SHELLS)('offers every command and template in %s', (shell) => {
    const script = renderCompletionScript(shell);

    for (const command of CLI_COMMANDS) {
      expect(script).toContain(command);
    }

    for (const template of SCAFFOLD_TEMPLATES) {
      expect(script).toContain(template);
    }

    for (const supported of COMPLETION_SHELLS) {
      expect(script).toContain(supported);
    }

    expect(script.endsWith('\n')).toBe(true);
  });

  /**
   * Fish names a long flag without its dashes, so a `toContain('--force')`
   * sweep reports every flag missing there and passes trivially everywhere
   * else. Each shell is checked in its own spelling, which is the only way this
   * catches a generator that stops iterating `CLI_FLAGS`.
   */
  test.each(COMPLETION_SHELLS)('offers every flag in %s', (shell) => {
    const script = renderCompletionScript(shell);

    for (const flag of CLI_FLAGS) {
      expect(script, `${shell} completion is missing ${flag}`).toContain(
        shell === 'fish' ? `-l ${flag.slice(2)} ` : flag,
      );
    }
  });

  test('emits the registration each shell actually loads', () => {
    expect(renderCompletionScript('bash')).toContain('complete -F _opencoven_complete opencoven');
    expect(renderCompletionScript('zsh')).toContain('compdef _opencoven opencoven');
    expect(renderCompletionScript('fish')).toContain('complete -c opencoven -f');
    expect(renderCompletionScript('powershell')).toContain(
      "Register-ArgumentCompleter -Native -CommandName opencoven",
    );
  });

  test('writes the script to stdout so a shell can source it directly', async () => {
    const result = await runCli(['completions', 'bash']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(renderCompletionScript('bash'));
  });

  test('carries the script and the shell in JSON output', async () => {
    const result = await runCli(['--json', 'completions', 'zsh']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'completions',
      data: {
        shell: 'zsh',
        script: renderCompletionScript('zsh'),
      },
      ok: true,
      version: DEV_CLI_VERSION,
    });
  });

  test('names the supported shells when one is missing or unknown', async () => {
    const missing = await runCli(['completions']);

    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toBe('Specify a shell: bash, zsh, fish, powershell.\n');

    const unknown = await runCli(['--json', 'completions', 'nushell']);

    expect(unknown.exitCode).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({
      command: 'completions',
      error: {
        code: 'unknown_shell',
        message:
          'Unsupported shell "nushell". Supported shells: bash, zsh, fish, powershell.',
      },
      ok: false,
    });
  });

  test('renders each shell deterministically', () => {
    for (const shell of COMPLETION_SHELLS satisfies readonly CompletionShell[]) {
      expect(renderCompletionScript(shell)).toBe(renderCompletionScript(shell));
    }
  });
});
