import {
  COMPLETION_SHELLS,
  isCompletionShell,
  renderCompletionScript,
} from './completions.js';
import { createCliDiagnostics, renderCliDiagnostics } from './diagnostics.js';
import { formatCliOutput, type CliOutput } from './output.js';
import {
  ScaffoldOverwriteError,
  ScaffoldPathError,
  writeScaffoldFiles,
} from './scaffold-writer.js';
import { SCAFFOLD_TEMPLATES, createScaffoldFiles, isScaffoldTemplate } from './scaffolds.js';
import { DEV_CLI_VERSION } from './version.js';

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type CliFormat = 'human' | 'json';

function createResult(
  output: CliOutput,
  format: CliFormat,
  exitCode: number,
  humanText?: string,
): CliRunResult {
  const rendered = formatCliOutput(output, format, humanText);

  return {
    exitCode,
    stdout: format === 'human' && !output.ok ? '' : rendered,
    stderr: format === 'human' && !output.ok ? rendered : '',
  };
}

function failure(
  command: string,
  code: string,
  message: string,
  format: CliFormat,
): CliRunResult {
  return createResult(
    {
      command,
      error: { code, message },
      ok: false,
      version: DEV_CLI_VERSION,
    },
    format,
    1,
  );
}

function runCompletions(argv: readonly string[], format: CliFormat): CliRunResult {
  const shell = argv[0];
  const supported = COMPLETION_SHELLS.join(', ');

  if (shell === undefined) {
    return failure('completions', 'missing_shell', `Specify a shell: ${supported}.`, format);
  }

  if (!isCompletionShell(shell)) {
    return failure(
      'completions',
      'unknown_shell',
      `Unsupported shell "${shell}". Supported shells: ${supported}.`,
      format,
    );
  }

  const script = renderCompletionScript(shell);

  return createResult(
    {
      command: 'completions',
      data: { shell, script },
      ok: true,
      version: DEV_CLI_VERSION,
    },
    format,
    0,
    script,
  );
}

function runDiagnostics(format: CliFormat): CliRunResult {
  const bundle = createCliDiagnostics({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  });

  return createResult(
    {
      command: 'diagnostics',
      data: { ...bundle },
      ok: true,
      version: DEV_CLI_VERSION,
    },
    format,
    0,
    renderCliDiagnostics(bundle),
  );
}

async function runScaffold(
  argv: readonly string[],
  force: boolean,
  format: CliFormat,
): Promise<CliRunResult> {
  const template = argv[0];
  const directory = argv[1];
  const supported = SCAFFOLD_TEMPLATES.join(', ');

  if (template === undefined) {
    return failure('scaffold', 'missing_template', `Specify a template: ${supported}.`, format);
  }

  if (!isScaffoldTemplate(template)) {
    return failure(
      'scaffold',
      'unknown_template',
      `Unsupported template "${template}". Supported templates: ${supported}.`,
      format,
    );
  }

  if (directory === undefined) {
    return failure(
      'scaffold',
      'missing_directory',
      `Specify a target directory: opencoven scaffold ${template} <directory>.`,
      format,
    );
  }

  const files = createScaffoldFiles(template);

  try {
    const written = await writeScaffoldFiles(files, directory, { force });

    return createResult(
      {
        command: 'scaffold',
        data: {
          template,
          directory: written.directory,
          files: written.files,
        },
        ok: true,
        version: DEV_CLI_VERSION,
      },
      format,
      0,
      [
        `Created opencoven-${template} in ${written.directory}`,
        '',
        ...written.files.map((path) => `  ${path}`),
        '',
        'Read README.md in that directory: the SDK packages are unpublished, so the',
        'scaffold installs them from packed tarballs.',
        '',
      ].join('\n'),
    );
  } catch (error) {
    if (error instanceof ScaffoldOverwriteError) {
      return failure('scaffold', 'scaffold_conflict', error.message, format);
    }

    if (error instanceof ScaffoldPathError) {
      return failure('scaffold', 'invalid_scaffold_path', error.message, format);
    }

    throw error;
  }
}

export function runCli(argv: readonly string[]): Promise<CliRunResult> {
  const format: CliFormat = argv.includes('--json') ? 'json' : 'human';

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

  const positional = argv.filter((argument) => !argument.startsWith('--'));
  const [command, ...rest] = positional;

  if (command === 'completions') {
    return Promise.resolve(runCompletions(rest, format));
  }

  if (command === 'diagnostics') {
    return Promise.resolve(runDiagnostics(format));
  }

  if (command === 'scaffold') {
    return runScaffold(rest, argv.includes('--force'), format);
  }

  return Promise.resolve(createResult(
    {
      command: positional.join(' ') || 'opencoven',
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
