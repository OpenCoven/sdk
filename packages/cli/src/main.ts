import { formatCliOutput, type CliOutput } from './output.js';
import { DEV_CLI_VERSION } from './version.js';

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function createResult(output: CliOutput, format: 'human' | 'json', exitCode: number): CliRunResult {
  return {
    exitCode,
    stdout: formatCliOutput(output, format),
    stderr: '',
  };
}

export function runCli(argv: readonly string[]): Promise<CliRunResult> {
  const format = argv.includes('--json') ? 'json' : 'human';

  if (argv.includes('--help') || argv.length === 0) {
    return Promise.resolve(createResult(
      {
        command: 'help',
        data: {
          name: 'opencoven',
        },
        ok: true,
        version: DEV_CLI_VERSION,
      },
      format,
      0,
    ));
  }

  if (argv.includes('--version')) {
    return Promise.resolve(createResult(
      {
        command: 'version',
        ok: true,
        version: DEV_CLI_VERSION,
      },
      format,
      0,
    ));
  }

  return Promise.resolve(createResult(
    {
      command: argv.filter((argument) => !argument.startsWith('--')).join(' ') || 'opencoven',
      error: {
        code: 'not_implemented',
        message: 'This command is reserved for a future operational task.',
      },
      ok: false,
      version: DEV_CLI_VERSION,
    },
    format,
    1,
  ));
}

export async function main(argv: readonly string[]): Promise<number> {
  const result = await runCli(argv);

  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }

  return result.exitCode;
}
