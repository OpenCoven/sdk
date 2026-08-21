import { createDiagnosticsBundle, type DiagnosticsBundle } from '@opencoven/sdk-core';

import { CLI_COMMANDS } from './completions.js';
import { DEV_CLI_VERSION } from './version.js';

/**
 * The CLI's own diagnostics.
 *
 * Deliberately local: the CLI configures no transport, so it has no endpoint to
 * describe and no client whose health it could report. What it can answer is
 * which binary is installed, on which runtime, offering which commands -- the
 * three facts a support thread opens by asking, and the three it currently has
 * to ask for by hand.
 *
 * Capabilities are derived from the dispatch table rather than listed here, so
 * a command that exists is reported and one that does not cannot be.
 */

export interface CliDiagnosticsRuntime {
  node: string;
  platform: string;
  arch: string;
}

export function createCliDiagnostics(runtime: CliDiagnosticsRuntime): DiagnosticsBundle {
  return createDiagnosticsBundle({
    packages: { '@opencoven/dev-cli': DEV_CLI_VERSION },
    runtime,
    capabilities: {
      cli: Object.fromEntries(CLI_COMMANDS.map((command) => [command, true])),
    },
  });
}

function section(title: string, lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [`${title}: none`];
  }

  return [`${title}:`, ...lines.map((line) => `  ${line}`)];
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function renderCliDiagnostics(bundle: DiagnosticsBundle): string {
  const packages = Object.entries(bundle.versions.packages).map(
    ([name, version]) => `${name} ${version}`,
  );
  const runtime = Object.entries(bundle.versions.runtime).map(
    ([name, value]) => `${name} ${String(value)}`,
  );
  const capabilities = Object.entries(bundle.capabilities).flatMap(([system, group]) =>
    Object.entries(group ?? {}).map(
      ([operation, available]) => `${system}.${operation}: ${yesNo(available)}`,
    ),
  );
  const discovery = bundle.discovery.map(
    (endpoint) =>
      `${endpoint.label}: protocol=${endpoint.protocol} host=${endpoint.host} port=${
        endpoint.port === null ? 'default' : String(endpoint.port)
      } loopback=${yesNo(endpoint.loopback)} credentials-in-url=${yesNo(
        endpoint.credentialsInUrl,
      )} query=${yesNo(endpoint.query)}`,
  );
  const operations = bundle.operations.map(
    (summary) =>
      `${summary.system}.${summary.operation}: started=${summary.started} succeeded=${
        summary.succeeded
      } failed=${summary.failed} timedOut=${summary.timedOut} aborted=${summary.aborted}`,
  );
  const errors = bundle.errors.map(
    (error) =>
      `${error.system}.${error.operation}: ${error.code} retryable=${yesNo(error.retryable)}`,
  );

  return [
    `OpenCoven diagnostics (${bundle.schema})`,
    '',
    ...section('Packages', packages),
    '',
    ...section('Runtime', runtime),
    '',
    ...section('Capabilities', capabilities),
    '',
    ...section('Discovery', discovery),
    '',
    ...section('Operations', operations),
    '',
    ...section('Errors', errors),
    '',
    'This bundle excludes prompts, tokens, attachments, and event payloads.',
    '',
  ].join('\n');
}
