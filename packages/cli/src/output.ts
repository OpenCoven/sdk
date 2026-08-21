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

/**
 * The human help text.
 *
 * It states the browser limitation because that is the question the CLI is in
 * front of when someone reaches for it, and a limitation documented only in a
 * README is one the reader finds after building against it.
 */
export const CLI_HELP_TEXT = [
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
].join('\n');

/**
 * `humanText` is a rendered body for commands that have one.
 *
 * It is a parameter rather than a field on `CliOutput` so that it never reaches
 * the JSON payload: the JSON contract is the machine-readable surface, and
 * carrying a second, prose rendering of the same data inside it would invite
 * consumers to parse the prose.
 */
export function formatCliOutput(
  output: CliOutput,
  format: 'human' | 'json',
  humanText?: string,
): string {
  if (format === 'json') {
    return `${JSON.stringify(output, null, 2)}\n`;
  }

  if (!output.ok) {
    return `${output.error?.message ?? 'OpenCoven command failed.'}\n`;
  }

  if (humanText !== undefined) {
    return humanText;
  }

  if (output.command === 'version') {
    return `${output.version}\n`;
  }

  return CLI_HELP_TEXT;
}
