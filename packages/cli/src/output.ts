export interface CliOutput {
  command: string;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  ok: boolean;
  version: string;
}

export function formatCliOutput(output: CliOutput, format: 'human' | 'json'): string {
  if (format === 'json') {
    return `${JSON.stringify(output, null, 2)}\n`;
  }

  if (!output.ok) {
    return `${output.error?.message ?? 'OpenCoven command failed.'}\n`;
  }

  if (output.command === 'version') {
    return `${output.version}\n`;
  }

  return [
    'OpenCoven developer CLI',
    '',
    'Usage:',
    '  opencoven [--help] [--version] [--json]',
    '',
    'This CLI owns the opencoven binary.',
    '',
  ].join('\n');
}
